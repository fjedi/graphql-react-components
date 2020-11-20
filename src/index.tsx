//
import * as React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import * as PropTypes from 'prop-types';
import { DocumentNode } from 'graphql';
import { Query as ApolloQuery, QueryComponentOptions } from '@apollo/client/react/components';
import {
  QueryHookOptions,
  useMutation,
  useQuery as ApolloUseQuery,
  OnSubscriptionDataOptions,
  ApolloError,
  FetchResult,
  MutationResult,
  MutationFunctionOptions,
  QueryResult,
} from '@apollo/client';
// @ts-ignore
import * as ApolloCacheUpdater_ from 'apollo-cache-updater';
import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { get, camelCase, isEqualWith, isEqual, uniq } from 'lodash';
import { Modal } from 'antd';

const ApolloCacheUpdater = ApolloCacheUpdater_;

export type DataRow = {
  id: string;
};

export type DataRowPaginatedList = {
  rows: DataRow[];
  count: number;
};

export type ApolloState = { [k: string]: unknown };

export function getListKeyFromDataType(dataType: string): string {
  return `get${dataType.replace(/y$/, 'ie')}s`;
}

export function logger(message: string | Error, props = {}): void {
  const level = get(props, 'level', 'info');
  if (process.env.RUNTIME_ENV !== 'production') {
    if (!message) {
      // eslint-disable-next-line no-console
      console.error('Logger has received event without message', props);
      return;
    }
    if (message instanceof Error) {
      // eslint-disable-next-line no-console
      console.error(message, props);
      return;
    }
    // eslint-disable-next-line no-console
    console[level](message, props);
  }
}
//
const ValidIdTypes = ['string', 'number'];
export function compareIds(id1: unknown, id2: unknown): boolean {
  //
  if (!ValidIdTypes.includes(typeof id1) || !ValidIdTypes.includes(typeof id2)) {
    return false;
  }
  return `${id1}` === `${id2}`;
}

export function compareValues(a: unknown, b: unknown): boolean {
  if (!a && !b) {
    return true;
  }
  if ((!a && b) || (a && !b)) {
    return false;
  }
  return isEqualWith(a, b, () =>
    // @ts-ignore
    uniq(Object.keys(a).concat(Object.keys(b))).every((field) => {
      const value = get(a, field);
      const newValue = get(b, field);
      if (typeof value !== 'object' || !value) {
        return isEqual(value, newValue);
      }
      return compareValues(value, newValue);
    }),
  );
}

export function updateAfterMutation(query: DocumentNode, dataType: string) {
  return (proxy: unknown, { data }: MutationResult): void => {
    const createdRow = get(data, `create${dataType}`) as DataRow | DataRow[];
    const removedRow = get(data, `remove${dataType}`) as DataRow | DataRow[];
    //
    const mutationResult = createdRow || removedRow;
    if (!mutationResult) {
      return;
    }
    (Array.isArray(mutationResult) ? mutationResult : [mutationResult]).forEach((row) => {
      //
      ApolloCacheUpdater({
        proxy, // mandatory
        operation: createdRow
          ? {
              type: 'ADD',
              add: (d: MutationResult) => {
                const result = get(d, 'data');
                if (Array.isArray(result)) {
                  if (result.some((r: DataRow) => r.id === row.id)) {
                    return result;
                  }
                  return Object.assign([row].concat(result));
                }
                //
                const { rows, count } = result;
                if (rows.some((r: DataRow) => r.id === row.id)) {
                  return result;
                }
                return Object.assign(result, {
                  count: count + 1,
                  rows: [row].concat(rows),
                });
              },
            }
          : {
              type: 'REMOVE',
              remove: (d: MutationResult) => {
                const result = get(d, 'data');
                if (Array.isArray(result)) {
                  return result.filter((r: DataRow) => !compareIds(r.id, row.id));
                }
                const { rows, count } = result;
                return Object.assign(result, {
                  count: count - 1,
                  rows: rows.filter((r: DataRow) => !compareIds(r.id, row.id)),
                });
              },
            },
        queriesToUpdate: [query],
        searchOperator: 'ANY',
        searchVariables: {},
        mutationResult: row,
      });
    });
  };
}

export const Query = ({ pollInterval, ...props }: QueryComponentOptions): JSX.Element => (
  <ApolloQuery
    partialRefetch
    returnPartialData
    errorPolicy="all"
    fetchPolicy="cache-and-network"
    pollInterval={typeof window !== 'undefined' ? pollInterval : 0}
    {...props}
  />
);
Query.propTypes = { pollInterval: PropTypes.number };
Query.defaultProps = { pollInterval: 0 };

//
export function getDataFromResponse(dataType: string) {
  return (data: QueryResult): DataRowPaginatedList => {
    const dataField = getListKeyFromDataType(dataType);
    if (data && data[dataField]) {
      return data[dataField];
    }
    return {
      rows: [],
      count: 0,
    };
  };
}

export function getDataFromSubscriptionEvent(dataType: string) {
  return (prev: ApolloState, { subscriptionData }: OnSubscriptionDataOptions): ApolloState => {
    if (!subscriptionData.data) return prev;
    const eventPrefix = camelCase(dataType);
    const createdRow = get(subscriptionData, `data.${eventPrefix}Created`);
    const changedRow = get(subscriptionData, `data.${eventPrefix}Changed`);
    const removedRow = get(subscriptionData, `data.${eventPrefix}Removed`);
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
    const listFieldName = getListKeyFromDataType(dataType);
    const prevData = prev[listFieldName] as DataRow[] | DataRowPaginatedList;
    logger(`[SUBSCRIPTION] get ${listFieldName}`, prevData);

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
    //
    const existRow = (Array.isArray(prevData) ? prevData : prevData.rows).find((e: DataRow) =>
      compareIds(e.id, event.id),
    );
    if (existRow) {
      logger(`[SUBSCRIPTION] ${dataType} already exists`, existRow);
      return prev;
    }

    //
    if (Array.isArray(prevData)) {
      return {
        ...prev,
        [listFieldName]: [event].concat(prevData),
      };
    }
    //
    return {
      ...prev,
      [listFieldName]: {
        ...prevData,
        count: prevData.count + 1,
        rows: [event].concat(prevData.rows),
      },
    };
  };
}

const initialSubscriptionsSet: Map<Document, { variables: unknown; unsubscribe: any }> = new Map(
  [],
);

export type SubscribeToMoreProps = {
  subscriptionQueries: Document[];
  variables: any;
  dataType: string;
  subscribeToMore: (params: { document: Document; variables: any; updateQuery: any }) => void;
};

export function useSubscribeToMore(props: SubscribeToMoreProps): void {
  logger('useSubscribeToMore', props);
  // const { subscriptionQueries, variables, dataType, subscribeToMore } = props;
  // const [subscriptions] = useState(initialSubscriptionsSet);
  // const updateQuery = useMemo(() => getDataFromSubscriptionEvent(dataType), []);
  const subscribe = useCallback(() => {
    // // @ts-ignore
    // [...subscriptions.entries()].forEach(([document, subscription]) => {
    //   const variablesChanged = !compareValues(variables, subscription.variables);
    //   if (variablesChanged) {
    //     logger('SubscriptionHandler.variablesChanged', {
    //       variables,
    //       oldVariables: subscription.variables,
    //       props,
    //     });
    //     subscription.unsubscribe();
    //     subscriptions.delete(document);
    //   }
    // });
    // //
    // if (Array.isArray(subscriptionQueries) && typeof subscribeToMore === 'function') {
    //   subscriptionQueries.forEach((document) => {
    //     if (subscriptions.has(document)) {
    //       return;
    //     }
    //     logger('SubscriptionHandler.initSubscription', variables);
    //     subscriptions.set(document, {
    //       variables,
    //       unsubscribe: subscribeToMore({
    //         document,
    //         variables,
    //         updateQuery,
    //       }),
    //     });
    //   });
    // }
  }, []);
  //
  useEffect(() => {
    subscribe();
  }, []);
}

export function onError(props: { t: TFunction }): (error: ApolloError) => void {
  const { t } = props;
  // @ts-ignore
  if (props.onError === 'function') {
    // @ts-ignore
    return (error: ApolloError) => props.onError(error);
  }
  //
  return (error: ApolloError) => {
    Modal.error({
      title: t('Error'),
      content: error.message.replace('GraphQL error:', ' ').trim(),
    });
  };
}

export type MutateFn = (
  options?: MutationFunctionOptions<any, Record<string, any>> | undefined,
) => Promise<FetchResult<any, Record<string, any>, Record<string, any>>>;

export type MutationProps = {
  children: (mutate: MutateFn, res: MutationResult) => void;
  autoCommitInterval?: number;
  mutation: DocumentNode;
};

export const Mutation = ({ children, autoCommitInterval, mutation, ...props }: MutationProps) => {
  const { t } = useTranslation();
  //
  const [mutate, res] = useMutation(mutation, {
    onError: onError({ t }),
    ...props,
  });
  //
  useEffect(() => {
    const autoCommitter =
      typeof autoCommitInterval === 'number' && autoCommitInterval > 0
        ? setInterval(mutate, autoCommitInterval)
        : null;
    //
    return () => {
      //
      if (autoCommitter) {
        clearInterval(autoCommitter);
      }
    };
  }, [autoCommitInterval]);

  return children(mutate, res);
};

export function useQuery(query: DocumentNode, options: QueryHookOptions): QueryResult {
  return ApolloUseQuery(query, {
    partialRefetch: true,
    returnPartialData: true,
    errorPolicy: 'all',
    // fetchPolicy: 'cache-and-network',
    ...(options || {}),
  });
}

export { useMutation, ApolloProvider, ApolloConsumer } from '@apollo/client';
export { graphql, withApollo } from '@apollo/client/react/hoc';
