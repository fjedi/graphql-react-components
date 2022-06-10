import { ApolloQueryResult, OperationVariables } from '@apollo/client/core';
import {
  ApolloCache,
  MutationResult,
  OnSubscriptionDataOptions,
  MutationUpdaterFunction,
  DefaultContext,
} from '@apollo/client';
import camelCase from 'lodash/camelCase';
import get from 'lodash/get';
import logger from './logger';
import { compareIds } from './helpers';

export type DataRow = {
  id: string;
};

export type PaginatedList = {
  rows: DataRow[];
  count: number;
};

export type GetListKeyFromDataTypeOptions = {
  suffix?: string;
  withGetPrefix?: boolean;
  variables?: OperationVariables;
};

export type ApolloState = { [k: string]: unknown };

export type CachedObjectRef = { __ref: string };

export function getListKeyFromDataType(
  dataType: string,
  options?: GetListKeyFromDataTypeOptions,
): string {
  const { suffix = '', withGetPrefix = false } = options ?? {};
  if (!withGetPrefix) {
    return `${camelCase(dataType).replace(/s$/, 'se').replace(/y$/, 'ie')}s${suffix}`;
  }
  return `get${dataType.replace(/s$/, 'se').replace(/y$/, 'ie')}s${suffix}`;
}

export function getDataFromResponse<T = unknown>(
  dataType: string,
  options?: GetListKeyFromDataTypeOptions,
) {
  return (data: ApolloQueryResult<T>): PaginatedList => {
    if (data) {
      return (
        // @ts-ignore
        data[getListKeyFromDataType(dataType, { ...options, suffix: 'V2' })] || // try to find latest version of the query (with 'V2' on the query-name end)
        // @ts-ignore
        data[getListKeyFromDataType(dataType, options)] || // try to find query with 'ies' or 'es' on the end of the name
        // try to find query with common 'List' suffix or fall-back to the object with empty rows-array and zero count
        // @ts-ignore
        data[`get${dataType}List`] ||
        // @ts-ignore
        data[`${dataType}s`] || { rows: [], count: 0 }
      );
    }
    return {
      rows: [],
      count: 0,
    };
  };
}

export function getDataFromSubscriptionEvent(
  dataType: string,
  options?: GetListKeyFromDataTypeOptions,
) {
  return (prev: ApolloState, { subscriptionData }: OnSubscriptionDataOptions): ApolloState => {
    if (!subscriptionData.data) {
      return prev;
    }
    const eventPrefix = camelCase(dataType);
    const createdRow = subscriptionData?.data?.[`${eventPrefix}Created`];
    const changedRow = subscriptionData?.data?.[`${eventPrefix}Updated`];
    const removedRow = subscriptionData?.data?.[`${eventPrefix}Removed`];
    const event = createdRow || changedRow || removedRow;
    logger(`[SUBSCRIPTION] ${dataType} create/change/remove`, {
      createdRow,
      changedRow,
      removedRow,
    });
    if (changedRow) {
      return prev;
    }
    //
    const listFieldName = getListKeyFromDataType(dataType, {
      ...(options ?? {}),
      withGetPrefix: options?.withGetPrefix ?? false,
    });
    const prevData = prev[listFieldName] as DataRow[] | PaginatedList;
    logger(`[SUBSCRIPTION] get ${listFieldName}`, { prevData });

    if (removedRow) {
      if (Array.isArray(prevData)) {
        return {
          ...prev,
          [listFieldName]: prevData.filter((e: DataRow) => !compareIds(e.id, removedRow.id)),
        };
      }
      return {
        ...prev,
        [listFieldName]: {
          ...prevData,
          count: prevData.count - 1,
          rows: prevData.rows.filter((e: DataRow) => !compareIds(e.id, removedRow.id)),
        },
      };
    }
    const rows = (Array.isArray(prevData) ? prevData : prevData?.rows) ?? [];
    //
    const existRow = rows.find((e: DataRow) => compareIds(e.id, event.id));
    if (existRow) {
      logger(`[SUBSCRIPTION] ${dataType} already exists`, existRow);
      return prev;
    }
    const updatedRows = rows.concat([event]);
    logger(`[SUBSCRIPTION] ${dataType} updatedRows`, { updatedRows });
    //
    if (Array.isArray(prevData)) {
      return {
        ...prev,
        [listFieldName]: updatedRows,
      };
    }
    //
    return {
      ...prev,
      [listFieldName]: {
        ...prevData,
        count: prevData.count + 1,
        rows: updatedRows,
      },
    };
  };
}

export function updateAfterMutation(
  dataType: string,
  listFieldName?: string,
): MutationUpdaterFunction<any, OperationVariables, DefaultContext, ApolloCache<any>> {
  return (cache: ApolloCache<unknown>, result: MutationResult): void => {
    const { data } = result;
    const createdRow = get(data, `create${dataType}`) as DataRow | DataRow[];
    const removedRow = get(data, `remove${dataType}`) as DataRow | DataRow[];
    //
    const mutationResult = createdRow || removedRow;
    if (!mutationResult) {
      return;
    }
    (Array.isArray(mutationResult) ? mutationResult : [mutationResult]).forEach((row) => {
      const cacheId = cache.identify(row);
      if (!cacheId) {
        return;
      }
      //
      cache.modify({
        fields: {
          [listFieldName || getListKeyFromDataType(dataType)](cachedData, { toReference }) {
            if (createdRow) {
              if (Array.isArray(cachedData)) {
                // eslint-disable-next-line no-underscore-dangle
                if (cachedData.some((r) => cacheId === r.__ref)) {
                  return cachedData;
                }
                return [toReference(cacheId)].concat(cachedData);
              }
              //
              const { rows, count } = cachedData;
              // eslint-disable-next-line no-underscore-dangle
              if (rows.some((r: CachedObjectRef) => cacheId === r.__ref)) {
                return cachedData;
              }
              return {
                count: count + 1,
                rows: [toReference(cacheId)].concat(rows),
              };
            }
            if (removedRow) {
              if (Array.isArray(cachedData)) {
                // eslint-disable-next-line no-underscore-dangle
                return cachedData.filter((r) => cacheId !== r.__ref);
              }
              const { rows, count } = cachedData;
              return {
                count: count - 1,
                // eslint-disable-next-line no-underscore-dangle
                rows: rows.filter((r: CachedObjectRef) => cacheId !== r.__ref),
              };
            }
            //
            return cachedData;
          },
        },
      });
    });
  };
}
