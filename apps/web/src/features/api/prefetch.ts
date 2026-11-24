import type { FetchQueryOptions, QueryClient, QueryKey } from "@tanstack/react-query";
import { registrationQuery } from "./account";
import {
  apiKeysQuery,
  backendsQuery,
  meQuery,
  mountsQuery,
  operationsQuery,
  overviewQuery,
  sessionQuery,
  storageSettingsQuery,
} from "./queries";

// What each page reads first, so the browser can ask for it while the page's code still loads,
// instead of once the page has rendered. A page reads anything else it needs as it renders.

/** One read, started on the client it is given. */
type Prefetchable = (client: QueryClient) => Promise<void>;

const read =
  <TData, TKey extends QueryKey>(options: FetchQueryOptions<TData, Error, TData, TKey>) =>
  (client: QueryClient) =>
    client.prefetchQuery(options);

/** What the Dashboard's shell reads on every page inside it. */
const SHELL: readonly Prefetchable[] = [read(meQuery), read(backendsQuery)];

const PAGES: Readonly<Record<string, readonly Prefetchable[]>> = {
  "/": [...SHELL, read(overviewQuery), read(operationsQuery), read(storageSettingsQuery)],
  "/files": [...SHELL, read(mountsQuery)],
  "/credentials": [...SHELL, read(apiKeysQuery), read(mountsQuery)],
  "/storage": [...SHELL, read(mountsQuery)],
  "/settings": SHELL,
  "/sign-in": [read(sessionQuery), read(registrationQuery)],
  "/register": [read(registrationQuery)],
};

/** The reads of the page at `pathname`, none for a path that is not a page. */
export const pageQueries = (pathname: string): readonly Prefetchable[] => {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, "") : pathname;
  return PAGES[path] ?? [];
};

/**
 * Starts the page's reads that the client has no fresh answer to, and resolves once all have
 * settled. A read that fails is left to the page, which shows why and offers to try again.
 */
export const prefetchPage = async (client: QueryClient, pathname: string): Promise<void> => {
  await Promise.all(pageQueries(pathname).map((prefetch) => prefetch(client)));
};
