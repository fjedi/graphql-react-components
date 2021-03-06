//
import * as React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import * as PropTypes from 'prop-types';
import { Context } from 'koa';
import { DocumentNode, OperationDefinitionNode } from 'graphql';
// Apollo client library
import {
  ApolloLink,
  ApolloClient as Client,
  from as mergeLinks,
  split,
  ApolloClientOptions as ClientOptions,
  NormalizedCacheObject,
} from '@apollo/client/core';
import { InMemoryCache } from 'apollo-cache-inmemory';
import { createPersistedQueryLink } from 'apollo-link-persisted-queries';
import DebounceLink from 'apollo-link-debounce';
import { getMainDefinition } from 'apollo-utilities';
import { createHttpLink } from '@apollo/client/link/http';
import { WebSocketLink } from '@apollo/client/link/ws';
import { onError as onApolloError } from '@apollo/client/link/error';
import { createUploadLink } from 'apollo-upload-client';
// @ts-ignore
import { ProgressiveFragmentMatcher } from 'apollo-progressive-fragment-matcher/lib/fragmentMatcher';
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
import ApolloCacheUpdater_ from 'apollo-cache-updater';
import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';
import { get, camelCase, isEqualWith, isEqual, uniq, pick, omit } from 'lodash';
import { Modal } from 'antd';

const ApolloCacheUpdater = ApolloCacheUpdater_;

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TodoAny = any;

export type DataRow = {
  id: string;
};

export type DataRowPaginatedList = {
  rows: DataRow[];
  count: number;
};

export type ApolloState = { [k: string]: unknown };

export type ApolloClientOptions = ClientOptions<TodoAny>;

export type ApolloClient = Client<TodoAny>;

export const fragmentMatcher = new ProgressiveFragmentMatcher({
  strategy: 'extension',
});

export const DEFAULT_DEBOUNCE_TIMEOUT = 300;

export function logger(message: string | Error, props = {}): void {
  const level = get(props, 'level', 'info');
  if (
    process.env.NEXT_PUBLIC_RUNTIME_ENV !== 'production' &&
    process.env.RUNTIME_ENV !== 'production'
  ) {
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
export const errorLink = onApolloError(({ response, graphQLErrors, networkError }) => {
  if (graphQLErrors && response) {
    // @ts-ignore
    response.errors = graphQLErrors.map((graphQLError) => {
      const { message, path } = graphQLError;
      logger(`[GraphQL error]: Message: ${message}, Path: ${path}`, graphQLError);
      return new Error(message);
    });
  }

  if (networkError) logger(`[Network error]: ${networkError}`);
});

// Helper function to create a new Apollo client, by merging in
// passed options alongside any set by `config.setApolloClientOptions` and defaults
export function createClient(opts: ApolloClientOptions): ApolloClient {
  return new Client({
    name: 'web',
    version: process.env.NEXT_PUBLIC_APP_VERSION || process.env.APP_VERSION,
    ...opts,
  });
}

export function serverClient(ctx: Context, o: ApolloClientOptions): ApolloClient {
  const headers = {
    Cookie: ctx.request.headers.cookie,
    // Pick some client's headers to bypass them to API
    ...pick(ctx.request.headers, [
      'x-real-ip',
      'x-forwarded-for',
      'user-agent',
      'lang',
      'accept-language',
      'accept-encoding',
    ]),
  };
  //
  const httpLink = createHttpLink({
    uri: o.uri,
    // credentials: 'same-origin',
    credentials: 'include',
    headers,
  });
  const persistedQueryLink = createPersistedQueryLink({
    // useGETForHashedQueries: true,
  });
  const cache = new InMemoryCache({ fragmentMatcher });
  //
  return createClient({
    ssrMode: true,
    // @ts-ignore
    cache,
    link: mergeLinks([
      fragmentMatcher.link(),
      errorLink,
      //
      persistedQueryLink,
      httpLink,
    ]),
    ...omit(o, ['cache', 'ssrMode']),
  });
}

// Creates a new browser client
export function browserClient(): ApolloClient {
  const state: NormalizedCacheObject | undefined =
    typeof window !== 'undefined' ? get(window, '__APOLLO_STATE__') : undefined;
  const uri = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || '';
  const isSSL = uri.indexOf('https') === 0;
  const wsURI = process.env.NEXT_PUBLIC_SUBSCRIPTIONS_URL || process.env.SUBSCRIPTIONS_URL || '';
  //
  const wsLink = new WebSocketLink({
    uri: wsURI.replace(/(https|http)/, isSSL ? 'wss' : 'ws'),
    options: {
      reconnect: true,
      connectionParams: {
        // token: 'get token from the cookies?',
      },
    },
  });
  //
  const metadataLink = new ApolloLink((operation, forward) => {
    // add the recent-activity custom header to the headers
    operation.setContext(({ headers = {} }) => ({
      headers: {
        ...headers,
        'x-timezone-offset': new Date().getTimezoneOffset(),
      },
    }));

    return forward(operation);
  });
  //
  const httpLink = createUploadLink({
    uri,
    credentials: 'include',
  });
  const persistedQueryLink = createPersistedQueryLink({
    // useGETForHashedQueries: true,
  });
  //
  const cache = state
    ? new InMemoryCache({ fragmentMatcher }).restore(state)
    : new InMemoryCache({ fragmentMatcher });
  //
  return createClient({
    // @ts-ignore
    cache,
    link: split(
      // split based on operation type
      ({ query }) => {
        const { kind, operation } = getMainDefinition(query) as OperationDefinitionNode;
        return kind === 'OperationDefinition' && operation === 'subscription';
      },
      wsLink,
      mergeLinks([
        metadataLink,
        fragmentMatcher.link(),
        new DebounceLink(DEFAULT_DEBOUNCE_TIMEOUT),
        errorLink,
        //
        persistedQueryLink,
        httpLink,
      ]),
    ),
    ssrForceFetchDelay: 100,
  });
}

export function getListKeyFromDataType(dataType: string): string {
  return `get${dataType.replace(/s$/, 'se').replace(/y$/, 'ie')}s`;
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
    if (data) {
      return (
        data[`get${dataType}List`] ||
        data[getListKeyFromDataType(dataType)] || { rows: [], count: 0 }
      );
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

const initialSubscriptionsSet: Map<
  Document,
  { dataType: string; variables: unknown; unsubscribe: any }
> = new Map([]);

export type SubscribeToMoreProps = {
  subscriptionQueries: Document[];
  variables: any;
  dataType: string;
  subscribeToMore: (params: { document: Document; variables: any; updateQuery: any }) => void;
};

export function useSubscribeToMore(props: SubscribeToMoreProps): void {
  const { subscriptionQueries, variables, dataType, subscribeToMore } = props;
  const [subscriptions] = useState(initialSubscriptionsSet);
  const updateQuery = useMemo(() => getDataFromSubscriptionEvent(dataType), [dataType]);
  const subscribe = useCallback(() => {
    //
    subscriptions.forEach((subscription, document) => {
      const variablesChanged =
        dataType === subscription.dataType && !compareValues(variables, subscription.variables);
      if (variablesChanged) {
        logger('SubscriptionHandler.variablesChanged', {
          dataType,
          variables,
          oldVariables: subscription.variables,
        });
        subscription.unsubscribe();
        subscriptions.delete(document);
      }
    });
    //
    if (Array.isArray(subscriptionQueries) && typeof subscribeToMore === 'function') {
      subscriptionQueries.forEach((document) => {
        if (subscriptions.has(document)) {
          return;
        }
        logger('SubscriptionHandler.initSubscription', { dataType, variables });
        subscriptions.set(document, {
          dataType,
          variables,
          unsubscribe: subscribeToMore({
            document,
            variables,
            updateQuery,
          }),
        });
      });
    }
  }, [subscriptions, updateQuery, subscriptionQueries, variables, dataType, subscribeToMore]);
  //
  useEffect(() => {
    subscribe();
  }, [subscribe]);
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
  options?: MutationFunctionOptions<TodoAny, Record<string, TodoAny>> | undefined,
) => Promise<FetchResult<TodoAny, Record<string, TodoAny>, Record<string, TodoAny>>>;

export type MutationProps = {
  children: (mutate: MutateFn, res: MutationResult) => void;
  autoCommitInterval?: number;
  mutation: DocumentNode;
};

export const Mutation = ({
  children,
  autoCommitInterval,
  mutation,
  ...props
}: MutationProps): void => {
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
    fetchPolicy: 'cache-and-network',
    ...(options || {}),
  });
}
export { MockedProvider } from '@apollo/client/testing';
export {
  useMutation,
  useSubscription,
  useApolloClient,
  ApolloProvider,
  ApolloConsumer,
  InMemoryCache,
} from '@apollo/client';
export { graphql, withApollo } from '@apollo/client/react/hoc';
