import { ApolloQueryResult, OperationVariables } from '@apollo/client/core';
import {
  ApolloCache,
  MutationResult,
  OnSubscriptionDataOptions,
  MutationUpdaterFunction,
  DefaultContext,
  LazyQueryResultTuple,
  QueryResult,
} from '@apollo/client';
import dayjs from 'dayjs';
import camelCase from 'lodash/camelCase';
import orderBy from 'lodash/orderBy';
import uniqBy from 'lodash/uniqBy';
import get from 'lodash/get';
import logger from './logger';
import { compareIds } from './helpers';

export type DataRow = {
  id: string;
};

export type PaginatedList = {
  rows: DataRow[];
  count: number;
  pageInfo: { current: number; total: number };
};

export type GetListKeyFromDataTypeOptions = {
  suffix?: string;
  withGetPrefix?: boolean;
  variables?: OperationVariables;
};

export type ApolloState = { [k: string]: unknown } | DataRow[];

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
  return (
    data: ApolloQueryResult<T> | LazyQueryResultTuple<T, QueryResult<T>>[1]['data'],
  ): PaginatedList => {
    if (data) {
      return (
        // try to find latest version of the query (with 'V2' on the query-name end)
        // @ts-ignore
        data[getListKeyFromDataType(dataType, { ...options, suffix: 'V2' })] ||
        // @ts-ignore
        data[getListKeyFromDataType(dataType, options)] || // try to find query with 'ies' or 'es' on the end of the name
        // try to find query with common 'List' suffix or fall-back to the object with empty rows-array and zero count
        // @ts-ignore
        data[`get${dataType}List`] ||
        // @ts-ignore
        data[`${dataType}s`] || { rows: [], count: 0, pageInfo: { current: 1, total: 1 } }
      );
    }
    return {
      rows: [],
      count: 0,
      pageInfo: { current: 1, total: 1 },
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
    const changedRow =
      subscriptionData?.data?.[`${eventPrefix}Updated`] ||
      subscriptionData?.data?.[`${eventPrefix}Changed`];
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
    const listFieldNameWithGetPrefix = getListKeyFromDataType(dataType, {
      ...(options ?? {}),
      withGetPrefix: true,
    });
    const withoutGetPrefix = !!prev[listFieldName];
    const cacheFieldName = withoutGetPrefix ? listFieldName : listFieldNameWithGetPrefix;
    const prevData = prev[cacheFieldName] as DataRow[] | PaginatedList;
    logger(`[SUBSCRIPTION] get ${listFieldName}`, { prevData });

    if (removedRow) {
      if (Array.isArray(prevData)) {
        return {
          ...prev,
          [cacheFieldName]: prevData.filter((e: DataRow) => !compareIds(e.id, removedRow.id)),
        };
      }
      return {
        ...prev,
        [cacheFieldName]: {
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
        [cacheFieldName]: updatedRows,
      };
    }
    //
    return {
      ...prev,
      [cacheFieldName]: {
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
      const cacheId = cache.identify({
        __ref: `${dataType}:${row.id}`,
      });
      if (!cacheId) {
        return;
      }
      //
      const field = listFieldName || getListKeyFromDataType(dataType);
      cache.modify({
        fields: {
          [field](cachedData, { toReference }) {
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

// NestedArray<T> represents T or Array of T or Array of Arrays of T .....
// let nestedNumbers: NestedArray<number> = [[[[[1]]]]];
export type NestedKeyArgsArray<T> = Array<T | NestedKeyArgsArray<T>>;

export function getCacheKeyArgs(args: any): NestedKeyArgsArray<string> {
  if (!args || Array.isArray(args) || typeof args !== 'object') {
    return [];
  }
  const keyArgs: NestedKeyArgsArray<string> = [];
  const { pagination, ...queryArgs } = args ?? {};
  Object.keys(queryArgs).forEach((arg) => {
    const v = args[arg];
    keyArgs.push(arg);
    if (v && typeof v === 'object') {
      const a = getCacheKeyArgs(v);
      if (a.length > 0) {
        keyArgs.push(a);
      }
    }
  });
  return keyArgs;
}

export const mergePaginatedList: {
  keyArgs: any;
  merge: (existing: PaginatedList, incoming: PaginatedList, context: any) => ApolloState;
} = {
  // Don't cache separate results based on
  // any of this field's arguments.
  keyArgs: getCacheKeyArgs,
  // Concatenate the incoming list items with
  // the existing list items.
  merge(existing: PaginatedList, incoming: PaginatedList, context: any) {
    const { direction, field } = context?.args?.sort ?? context?.variables?.sort ?? {};
    const r = uniqBy([...(existing?.rows ?? []), ...(incoming?.rows ?? [])], '__ref');
    const rows =
      direction && field
        ? orderBy(
            r,
            (ref) => {
              const value = context.readField(field, ref);
              if (dayjs(value).isValid()) {
                return dayjs(value).unix();
              }
              return value;
            },
            direction.toLowerCase(),
          )
        : r;
    return {
      ...(existing || {}),
      ...(incoming || {}),
      rows,
    };
  },
};

export const mergeList: {
  keyArgs: any;
  merge: (existing: DataRow[], incoming: DataRow[], context: any) => ApolloState;
} = {
  // Don't cache separate results based on
  // any of this field's arguments.
  keyArgs: getCacheKeyArgs,
  // Concatenate the incoming list items with
  // the existing list items.
  merge(existing: DataRow[], incoming: DataRow[], context: any) {
    const { direction, field } = context?.args?.sort ?? context?.variables?.sort ?? {};
    const r = uniqBy([...(existing ?? []), ...(incoming ?? [])], '__ref');
    const rows =
      direction && field
        ? orderBy(
            r,
            (ref) => {
              const value = context.readField(field, ref);
              if (dayjs(value).isValid()) {
                return dayjs(value).unix();
              }
              return value;
            },
            direction.toLowerCase(),
          )
        : r;
    logger('mergeList', { existing, incoming, rows, direction, field });

    return rows;
  },
};
