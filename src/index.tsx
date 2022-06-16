import * as React from 'react';
import * as PropTypes from 'prop-types';
import { Query as ApolloQuery, QueryComponentOptions } from '@apollo/client/react/components';
import graphQLLogger from './logger';
import { useMutation, MutationProps } from './hooks';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TodoAny = any;

export const logger = graphQLLogger;

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
  TypedDocumentNode,
} from '@apollo/client/core';
export {
  DefaultContext,
  ApolloQueryResult,
  MutationUpdaterFn,
  OperationVariables,
} from '@apollo/client/core/types';
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
export { createClient, ApolloClient, ApolloClientOptions, errorLink } from './client';
export { serverClient } from './entrypoints/server';
export {
  browserClient,
  BrowserClientMiddleware,
  BrowserClientParams,
  uploadFetch,
  ApolloUploadFetchOptions,
  parseXHRHeaders,
  DEFAULT_DEBOUNCE_TIMEOUT,
} from './entrypoints/browser';
