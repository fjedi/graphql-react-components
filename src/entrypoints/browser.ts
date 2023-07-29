import { OperationDefinitionNode } from 'graphql';
import {
  ApolloLink,
  from as mergeLinks,
  split,
  InMemoryCache,
  InMemoryCacheConfig,
  NormalizedCacheObject,
  Operation,
} from '@apollo/client/core';
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { sha256 } from 'crypto-hash';
import DebounceLink from 'apollo-link-debounce';
import { getMainDefinition } from '@apollo/client/utilities';
import { GraphQLWsLink } from '@apollo/client/link/subscriptions';
import { createUploadLink } from 'apollo-upload-client';
import { createClient as createWsClient } from 'graphql-ws';
import get from 'lodash/get';
import logger from '../logger';
import { ApolloClient, createClient, errorLink } from '../client';

export const DEFAULT_DEBOUNCE_TIMEOUT = 300;

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

export type ApolloUploadFetchOptions = RequestInit & {
  method: string;
  onProgress?: (this: XMLHttpRequest, ev: ProgressEvent<EventTarget>) => void | null;
  onAbortPossible: (abortHandler: () => void) => void;
  headers: Headers;
};

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

    xhr.send(options.body as any);
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
    process.env.API_URL ||
    process.env.NEXT_PUBLIC_API_URL || // support public nextjs env-vars
    // support segmented api-url passed in nextjs env-vars
    `${process.env.NEXT_PUBLIC_API_PROTO || ''}://${process.env.NEXT_PUBLIC_API_HOST || ''}${
      process.env.NEXT_PUBLIC_API_URI || ''
    }` ||
    '';
  const isSSL = uri.indexOf('https') === 0;
  const wsURI =
    wsURL ||
    process.env.SUBSCRIPTIONS_URL ||
    process.env.NEXT_PUBLIC_SUBSCRIPTIONS_URL || // support public nextjs env-vars
    // support segmented ws-url passed in nextjs env-vars
    `${process.env.NEXT_PUBLIC_API_PROTO || ''}://${process.env.NEXT_PUBLIC_API_HOST || ''}${
      process.env.NEXT_PUBLIC_SUBSCRIPTIONS_URI || ''
    }` ||
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
      // When configuring your file upload client, we need to send a non-empty
      // Apollo-Require-Preflight header or Apollo Server will block the request. (CSRF prevention)
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
