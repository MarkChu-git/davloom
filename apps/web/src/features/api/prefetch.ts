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
  <TData, TKey extends QueryKey>(
    options: FetchQueryOptions<TData, Error, TData, TKey>,
    framePath?: string,
  ) =>
  (client: QueryClient) => {
    const started = framePath === undefined ? undefined : takeFrameRead(framePath);
    if (started === undefined) return client.prefetchQuery(options);
    const { queryFn } = options;
    return client.prefetchQuery({
      ...options,
      // The answer the frame's script already asked for; a failed one is read again, so the
      // page learns why from the API client.
      queryFn: (context) =>
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer for this query
        (started as Promise<TData>).catch(() =>
          typeof queryFn === "function" ? queryFn(context) : Promise.reject(new Error(framePath)),
        ),
    });
  };

/**
 * The read the script in the page's head (features/frame/fill.ts) started for `path`, if any. It
 * is handed out once: a later read of the same data asks the API afresh.
 */
export const takeFrameRead = (path: string): Promise<unknown> | undefined => {
  if (typeof window === "undefined") return undefined;
  const reads = window.davloomFrameReads;
  const started = reads?.[path];
  if (reads !== undefined) delete reads[path];
  return started;
};

/** What the Dashboard's shell reads on every page inside it. */
const SHELL: readonly Prefetchable[] = [read(meQuery, "/api/me"), read(backendsQuery)];

const PAGES: Readonly<Record<string, readonly Prefetchable[]>> = {
  "/": [
    ...SHELL,
    read(overviewQuery, "/api/overview"),
    read(operationsQuery),
    read(storageSettingsQuery),
  ],
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
