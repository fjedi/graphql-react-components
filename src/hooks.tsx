import { useCallback, useEffect, useMemo, useRef } from 'react';
import {
  QueryHookOptions,
  useMutation as ApolloUseMutation,
  useQuery as ApolloUseQuery,
  MutationResult,
  MutationFunctionOptions,
  QueryResult,
  MutationTuple,
  ApolloError,
  DefaultContext,
  ApolloCache,
} from '@apollo/client';
import { OperationVariables, FetchResult, TypedDocumentNode } from '@apollo/client/core';
import { MutationHookOptions } from '@apollo/client/react';
import { DocumentNode } from 'graphql';
import { useTranslation } from 'react-i18next';
import Modal from 'antd/lib/modal';
import { compareValues } from './helpers';
import { getDataFromSubscriptionEvent } from './cache-manager';
import logger from './logger';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TodoAny = any;

export type UnsubscribeToMoreFn = () => void;

export type SubscribeToMoreProps = {
  subscriptionId: string;
  subscriptionQueries: DocumentNode[];
  variables: OperationVariables;
  dataType: string;
  subscribeToMore: (params: {
    document: DocumentNode;
    variables: OperationVariables;
    updateQuery: any;
  }) => UnsubscribeToMoreFn;
};

export function usePreviousValue(value: unknown) {
  const ref = useRef<unknown>();
  useEffect(() => {
    ref.current = value;
  }, [value]);
  return ref.current;
}

export function useSubscribeToMore(props: SubscribeToMoreProps): void {
  const { subscriptionQueries, variables, dataType, subscribeToMore, subscriptionId } = props;
  const updateQuery = useMemo(
    () =>
      getDataFromSubscriptionEvent(dataType, {
        variables,
      }),
    [dataType, variables],
  );
  const previousVariables = usePreviousValue(variables);
  const variablesChanged = !compareValues(variables, previousVariables);

  const subscribe = useCallback(() => {
    return subscriptionQueries.map((document) => {
      logger('SubscriptionHandler.initSubscription', { subscriptionId, dataType, variables });
      return subscribeToMore({
        document,
        variables,
        updateQuery,
      });
    });
  }, [subscriptionId, updateQuery, subscriptionQueries, variables, dataType, subscribeToMore]);
  //
  useEffect(() => {
    const unsubscribeCallbacks = subscribe();
    return () => {
      unsubscribeCallbacks.forEach((unsubscribe) => unsubscribe());
    };
  }, [subscribe, variablesChanged]);
}

export function useApolloError() {
  const { t } = useTranslation();
  return (error: ApolloError) => {
    Modal.error({
      title: t('Error') as string,
      content: error.message.replace('GraphQL error:', ' ').trim(),
    });
  };
}

export function useQuery(query: DocumentNode, options: QueryHookOptions): QueryResult {
  return ApolloUseQuery(query, {
    partialRefetch: true,
    returnPartialData: true,
    errorPolicy: 'all',
    fetchPolicy: 'cache-and-network',
    ...(options || {}),
  });
}

export type MutateFn = (
  options?: MutationFunctionOptions<TodoAny, Record<string, TodoAny>> | undefined,
) => Promise<FetchResult<TodoAny, Record<string, TodoAny>, Record<string, TodoAny>>>;

export type MutationProps = {
  children: (mutate: MutateFn, res: MutationResult) => void;
  autoCommitInterval?: number;
  mutation: DocumentNode;
};

export function useMutation<
  TData = TodoAny,
  TVariables = OperationVariables,
  TContext = DefaultContext,
  TCache extends ApolloCache<TodoAny> = ApolloCache<TodoAny>,
>(
  mutation: DocumentNode | TypedDocumentNode<TData, TVariables>,
  options: MutationHookOptions<TData, TVariables, TContext> & { autoCommitInterval?: number },
): MutationTuple<TData, TVariables, TContext, TCache> {
  const onError = useApolloError();
  const { autoCommitInterval } = options || {};
  //
  const mutationTuple = ApolloUseMutation(mutation, {
    onError,
    onCompleted(res) {
      logger('useMutation.onCompleted', { res });
    },
    ...(options || {}),
  });
  //
  const [mutate] = mutationTuple;
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
  //
  return mutationTuple;
}
