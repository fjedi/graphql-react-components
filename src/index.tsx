//
import * as React from 'react';
import { useState, useCallback, useMemo, useEffect } from 'react';
import * as PropTypes from 'prop-types';
import { DocumentNode, OperationDefinitionNode } from 'graphql';
// Apollo client library
// eslint-disable-next-line import/no-extraneous-dependencies
import {
  ApolloLink,
  ApolloClient as Client,
  from as mergeLinks,
  split,
  ApolloClientOptions as ClientOptions,
  InMemoryCache,
  InMemoryCacheConfig,
  NormalizedCacheObject,
  Operation,
} from '@apollo/client/core';
// import { createPersistedQueryLink } from 'apollo-link-persisted-queries';
import DebounceLink from 'apollo-link-debounce';
import { getMainDefinition } from 'apollo-utilities';
// eslint-disable-next-line import/no-extraneous-dependencies
import { createHttpLink } from '@apollo/client/link/http';
// eslint-disable-next-line import/no-extraneous-dependencies
import { WebSocketLink } from '@apollo/client/link/ws';
// eslint-disable-next-line import/no-extraneous-dependencies
import { onError as onApolloError } from '@apollo/client/link/error';
import { createUploadLink } from 'apollo-upload-client';
// eslint-disable-next-line import/no-extraneous-dependencies
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
import get from 'lodash/get';
import camelCase from 'lodash/camelCase';
import isEqualWith from 'lodash/isEqualWith';
import isEqual from 'lodash/isEqual';
import uniq from 'lodash/uniq';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import { Modal } from 'antd';
import { DefaultError } from '@fjedi/errors';

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

export type ApolloClientOptions = ClientOptions<TodoAny> & {
  cacheOptions?: InMemoryCacheConfig;
};

export type ApolloClient = Client<TodoAny>;

export type ApolloUploadFetchOptions = RequestInit & {
  method: string;
  onProgress?: (this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => void | null;
  onAbortPossible: (abortHandler: () => void) => void;
  headers: Headers;
};

export const DEFAULT_DEBOUNCE_TIMEOUT = 300;

export function logger(message: string | Error, props = {}): void {
  const level = get(props, 'level', 'info');
  if (
    process.env.NEXT_PUBLIC_RUNTIME_ENV !== 'production' && // support public nextjs env-vars
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
      return new DefaultError(message, {
        originalError: graphQLError,
        meta: graphQLError.extensions,
      });
    });
  }

  if (networkError) logger(`[Network error]: ${networkError}`);
});

export function parseXHRHeaders(rawHeaders: string): Headers {
  const headers = new Headers();
  // Replace instances of \r\n and \n followed by at least one space or horizontal tab with a space
  // https://tools.ietf.org/html/rfc7230#section-3.2
  const preProcessedHeaders = rawHeaders.replace(/\r?\n[\t ]+/g, ' ');
  preProcessedHeaders.split(/\r?\n/).forEach((line: string) => {
    const parts = line.split(':');
    const key = parts.shift()?.trim();
    if (key) {
      const value = parts.join(':').trim();
      headers.append(key, value);
    }
  });
  return headers;
}

export const uploadFetch = (url: string, options: ApolloUploadFetchOptions): Promise<Response> =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.withCredentials = options.credentials !== 'omit';
    xhr.onload = () => {
      const opts: {
        status: XMLHttpRequest['status'];
        statusText: string;
        headers: Headers;
        url?: string | null;
      } = {
        status: xhr.status,
        statusText: xhr.statusText,
        headers: parseXHRHeaders(xhr.getAllResponseHeaders() || ''),
      };
      opts.url = 'responseURL' in xhr ? xhr.responseURL : opts.headers.get('X-Request-URL');
      const body = 'response' in xhr ? xhr.response : (xhr as XMLHttpRequest).responseText;
      resolve(new Response(body, opts));
    };
    xhr.onerror = () => {
      reject(new TypeError('Network request failed'));
    };
    xhr.ontimeout = () => {
      reject(new TypeError('Network request failed'));
    };
    xhr.open(options.method, url, true);

    Object.keys(options.headers).forEach((key) => {
      xhr.setRequestHeader(key, options.headers[key]);
    });

    if (xhr.upload && typeof options.onProgress === 'function') {
      xhr.upload.onprogress = options.onProgress;
    }

    options.onAbortPossible(() => {
      xhr.abort();
    });

    xhr.send(options.body);
  });

// Helper function to create a new Apollo client, by merging in
// passed options alongside any set by `config.setApolloClientOptions` and defaults
export function createClient(opts: ApolloClientOptions): ApolloClient {
  return new Client({
    name: 'web',
    version:
      process.env.NEXT_PUBLIC_APP_VERSION || // support public nextjs env-vars
      process.env.APP_VERSION,
    ...opts,
  });
}

export function serverClient<TContext>(ctx: TContext, o: ApolloClientOptions): ApolloClient {
  const headers = {
    // @ts-ignore
    Cookie: ctx.request.headers.cookie,
    // Pick some client's headers to bypass them to API
    // @ts-ignore
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
  // const persistedQueryLink = createPersistedQueryLink({
  //   // useGETForHashedQueries: true,
  // });
  const cache = new InMemoryCache(o.cacheOptions);
  //
  return createClient({
    ssrMode: true,
    // @ts-ignore
    cache,
    link: mergeLinks([
      errorLink,
      //
      // persistedQueryLink,
      httpLink,
    ]),
    ...omit(o, ['cache', 'ssrMode']),
  });
}

export type BrowserClientMiddleware = (operation: Operation) => void;

export type BrowserClientParams = {
  url?: string;
  wsURL?: string;
  middlewares?: BrowserClientMiddleware[];
  initialState?: NormalizedCacheObject;
  cacheOptions?: InMemoryCacheConfig;
};

// Creates a new browser client
export function browserClient(params?: BrowserClientParams): ApolloClient {
  const { url, wsURL, middlewares, initialState } = params || {};
  const state: NormalizedCacheObject | undefined =
    initialState || typeof window !== 'undefined' ? get(window, '__APOLLO_STATE__') : undefined;
  const uri =
    url || //
    process.env.NEXT_PUBLIC_API_URL || // support public nextjs env-vars
    process.env.API_URL ||
    '';
  const isSSL = uri.indexOf('https') === 0;
  const wsURI =
    wsURL ||
    process.env.NEXT_PUBLIC_SUBSCRIPTIONS_URL || // support public nextjs env-vars
    process.env.SUBSCRIPTIONS_URL ||
    '';
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
    //
    if (Array.isArray(middlewares)) {
      middlewares.forEach((middleware) => {
        //
        if (typeof middleware !== 'function') {
          return;
        }
        middleware(operation);
      });
    }
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
    fetch(u: string, options: ApolloUploadFetchOptions) {
      if (typeof options.onProgress === 'function') {
        return uploadFetch(u, options);
      }
      return fetch(u, options);
    },
  });
  // const persistedQueryLink = createPersistedQueryLink({
  //   // useGETForHashedQueries: true,
  // });
  //
  const cache = state
    ? new InMemoryCache(params?.cacheOptions).restore(state)
    : new InMemoryCache(params?.cacheOptions);
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
        new DebounceLink(DEFAULT_DEBOUNCE_TIMEOUT),
        errorLink,
        //
        // persistedQueryLink,
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
    // eslint-disable-next-line react/jsx-props-no-spreading
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

export type UnsubscribeToMoreFn = () => void;

const initialSubscriptionsSet: Map<
  Document,
  { id: string; dataType: string; variables: unknown; unsubscribe: UnsubscribeToMoreFn }
> = new Map([]);

export type SubscribeToMoreProps = {
  subscriptionId: string;
  subscriptionQueries: Document[];
  variables: unknown;
  dataType: string;
  subscribeToMore: (params: {
    document: Document;
    variables: unknown;
    updateQuery: any;
  }) => UnsubscribeToMoreFn;
};

export function useSubscribeToMore(props: SubscribeToMoreProps): void {
  const { subscriptionQueries, variables, dataType, subscribeToMore, subscriptionId } = props;
  const [subscriptions] = useState(initialSubscriptionsSet);
  const updateQuery = useMemo(() => getDataFromSubscriptionEvent(dataType), [dataType]);
  const subscribe = useCallback(() => {
    //
    subscriptions.forEach((subscription, document) => {
      const variablesChanged =
        (compareIds(subscription.id, subscriptionId) ||
          (!subscriptionId && dataType === subscription.dataType)) &&
        !compareValues(variables, subscription.variables);
      if (variablesChanged) {
        logger('SubscriptionHandler.variablesChanged', {
          subscriptionId,
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
        logger('SubscriptionHandler.initSubscription', { subscriptionId, dataType, variables });
        subscriptions.set(document, {
          id: subscriptionId,
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
  }, [
    subscriptionId,
    subscriptions,
    updateQuery,
    subscriptionQueries,
    variables,
    dataType,
    subscribeToMore,
  ]);
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
  }, [mutate, autoCommitInterval]);

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
// eslint-disable-next-line import/no-extraneous-dependencies
export { MockedProvider } from '@apollo/client/testing';
export {
  useLazyQuery,
  useMutation,
  useSubscription,
  useApolloClient,
  ApolloProvider,
  ApolloConsumer,
  ApolloCache,
  InMemoryCache,
  InMemoryCacheConfig,
} from '@apollo/client';
// eslint-disable-next-line import/no-extraneous-dependencies
export { graphql, withApollo } from '@apollo/client/react/hoc';
export {
  getDataFromTree,
  getMarkupFromTree,
  renderToStringWithData,
} from '@apollo/client/react/ssr';
