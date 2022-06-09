import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { compareIds, compareValues } from './helpers';
import { getDataFromSubscriptionEvent } from './cache-manager';
import logger from './logger';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TodoAny = any;

export type UnsubscribeToMoreFn = () => void;

const initialSubscriptionsSet: Map<
  DocumentNode,
  { id: string; dataType: string; variables: OperationVariables; unsubscribe: UnsubscribeToMoreFn }
> = new Map([]);

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

export function useSubscribeToMore(props: SubscribeToMoreProps): void {
  const { subscriptionQueries, variables, dataType, subscribeToMore, subscriptionId } = props;
  const [subscriptions] = useState(initialSubscriptionsSet);
  const updateQuery = useMemo(
    () =>
      getDataFromSubscriptionEvent(dataType, {
        variables,
      }),
    [dataType],
  );
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
