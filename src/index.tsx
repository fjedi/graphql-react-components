// Ponyfill for isomorphic 'fetch'
import fetch from 'cross-fetch';
import * as React from 'react';
import * as PropTypes from 'prop-types';
import { OperationDefinitionNode } from 'graphql';
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
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { sha256 } from 'crypto-hash';
import DebounceLink from 'apollo-link-debounce';
import { getMainDefinition } from '@apollo/client/utilities';
// eslint-disable-next-line import/no-extraneous-dependencies
import { createHttpLink } from '@apollo/client/link/http';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
// eslint-disable-next-line import/no-extraneous-dependencies
import { onError as onApolloError } from '@apollo/client/link/error';
import { createUploadLink } from 'apollo-upload-client';
// eslint-disable-next-line import/no-extraneous-dependencies
import { Query as ApolloQuery, QueryComponentOptions } from '@apollo/client/react/components';
import { createClient as createWsClient } from 'graphql-ws';
import get from 'lodash/get';
import pick from 'lodash/pick';
import omit from 'lodash/omit';
import graphQLLogger from './logger';
import { useMutation, MutationProps } from './hooks';
import { DefaultError } from './errors';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TodoAny = any;

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

export const logger = graphQLLogger;

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

export function uploadFetch(url: string, options: ApolloUploadFetchOptions): Promise<Response> {
  return new Promise((resolve, reject) => {
    if (typeof window === 'undefined' || typeof XMLHttpRequest === 'undefined') {
      reject(new Error('XMLHttpRequest is not defined'));
      return;
    }
    const logMessagePrefix = '[graphQL.uploadFetch] ';
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
      logger(`${logMessagePrefix}File successfully uploaded`, { body, opts });
      resolve(new Response(body, opts));
    };
    xhr.onerror = (e: unknown) => {
      const m = `${logMessagePrefix}Network request failed`;
      logger(m, e as Error);
      reject(new Error(m));
    };
    xhr.ontimeout = (e: unknown) => {
      const m = `${logMessagePrefix}Upload request timed out`;
      logger(m, e as Error);
      reject(new Error(m));
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

    xhr.send(options.body as TodoAny);
  });
}

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

export function serverClient<TContext>(
  ctx: TContext,
  o: Omit<ApolloClientOptions, 'cache'>,
): ApolloClient {
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
  const persistedQueryLink = createPersistedQueryLink({
    useGETForHashedQueries: true,
    sha256,
  });
  const cache = new InMemoryCache(o.cacheOptions);
  //
  return createClient({
    ssrMode: true,
    cache,
    link: mergeLinks([errorLink, persistedQueryLink, httpLink]),
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
  ssrForceFetchDelay?: number;
  usePersistedQueries?: boolean;
};

// Creates a new browser client
export function browserClient(params?: BrowserClientParams): ApolloClient {
  const { url, wsURL, middlewares, initialState, usePersistedQueries = true } = params || {};
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
  const wsLink = wsURI
    ? new GraphQLWsLink(
        createWsClient({
          url: wsURI.replace(/(https|http)/, isSSL ? 'wss' : 'ws'),
        }),
      )
    : null;
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
    headers: {
      // When configuring your file upload client, we need to send a non-empty Apollo-Require-Preflight header or Apollo Server will block the request. (CSRF prevention)
      'Apollo-Require-Preflight': 'true',
    },
    fetch(u: string, options: ApolloUploadFetchOptions) {
      if (typeof options.onProgress === 'function') {
        return uploadFetch(u, options);
      }
      return fetch(u, options);
    },
  });
  const persistedQueryLink = usePersistedQueries
    ? createPersistedQueryLink({
        useGETForHashedQueries: true,
        sha256,
      })
    : null;
  //
  const cache = state
    ? new InMemoryCache(params?.cacheOptions).restore(state)
    : new InMemoryCache(params?.cacheOptions);

  const httpLinks = mergeLinks([
    metadataLink,
    new DebounceLink(DEFAULT_DEBOUNCE_TIMEOUT),
    errorLink,
    persistedQueryLink
      ? split(
          // Do not use persistedQueryLink for mutations
          ({ query }) => {
            const { operation } = getMainDefinition(query) as OperationDefinitionNode;
            return operation === 'mutation';
          },
          httpLink,
          mergeLinks([persistedQueryLink, httpLink]),
        )
      : httpLink,
  ]);

  if (!wsLink) {
    return createClient({
      cache,
      link: httpLinks,
      ssrForceFetchDelay: params?.ssrForceFetchDelay,
    });
  }
  //
  return createClient({
    cache,
    link: split(
      // split based on operation type
      ({ query }) => {
        const { kind, operation } = getMainDefinition(query) as OperationDefinitionNode;
        return kind === 'OperationDefinition' && operation === 'subscription';
      },
      wsLink,
      httpLinks,
    ),
    ssrForceFetchDelay: params?.ssrForceFetchDelay,
  });
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

export const Mutation = ({ children, mutation, ...props }: MutationProps): void => {
  //
  const [mutate, res] = useMutation(mutation, props);

  return children(mutate, res);
};

// eslint-disable-next-line import/no-extraneous-dependencies
export { MockedProvider } from '@apollo/client/testing';
export {
  useLazyQuery,
  useSubscription,
  useApolloClient,
  ApolloProvider,
  ApolloConsumer,
  ApolloCache,
  ApolloError,
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
export { createHttpLink } from '@apollo/client/link/http';
export {
  ApolloLink,
  from as mergeLinks,
  split,
  ApolloClientOptions as ClientOptions,
  NormalizedCacheObject,
  Operation,
  DefaultContext,
  OperationVariables,
  TypedDocumentNode,
} from '@apollo/client/core';
export { DocumentNode, OperationDefinitionNode } from 'graphql';
export { compareIds, compareValues } from './helpers';
export {
  useQuery,
  useMutation,
  useApolloError,
  useSubscribeToMore,
  SubscribeToMoreProps,
  UnsubscribeToMoreFn,
  usePreviousValue,
} from './hooks';
export {
  DataRow,
  PaginatedList,
  ApolloState,
  CachedObjectRef,
  getListKeyFromDataType,
  getDataFromResponse,
  getDataFromSubscriptionEvent,
  updateAfterMutation,
  mergePaginatedList,
  getCacheKeyArgs,
  NestedKeyArgsArray,
} from './cache-manager';
