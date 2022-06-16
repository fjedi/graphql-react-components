import { from as mergeLinks, InMemoryCache } from '@apollo/client/core';
import { createHttpLink } from '@apollo/client/link/http';
import { createPersistedQueryLink } from '@apollo/client/link/persisted-queries';
import { sha256 } from 'crypto-hash';
import omit from 'lodash/omit';
import pick from 'lodash/pick';
import { ApolloClient, ApolloClientOptions, createClient, errorLink } from '../client';

export {
  getDataFromTree,
  getMarkupFromTree,
  renderToStringWithData,
} from '@apollo/client/react/ssr';

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
