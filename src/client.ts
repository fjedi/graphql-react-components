// Apollo client library
import {
  ApolloClient as Client,
  ApolloClientOptions as ClientOptions,
  InMemoryCacheConfig,
} from '@apollo/client/core';
import { onError as onApolloError } from '@apollo/client/link/error';
import logger from './logger';
import { DefaultError } from './errors';

// @ts-ignore
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TodoAny = any;

export type ApolloClientOptions = ClientOptions<TodoAny> & {
  cacheOptions?: InMemoryCacheConfig;
};

export type ApolloClient = Client<TodoAny>;

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
