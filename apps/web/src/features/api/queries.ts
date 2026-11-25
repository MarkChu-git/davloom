import {
  QueryCache,
  QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Translator } from "../i18n/translate";
import type { Answer } from "@davloom/client";
import { api, apiCall, authFetch, isApiError, isUnauthorized } from "./client";

// Server state of the Dashboard, read and changed through TanStack Query. The shapes are the JSON
// answers of apps/api/src/app.ts.

// Every answer's type is the server's (packages/client): the contracts of packages/schema, which
// the API encodes its answers through.

/** The signed-in owner: `verifiedAt` is when this session last proved presence, in ms. */
export type User = Answer<"GET /api/me">;

/** What the Overview reads: usage, Mounts and backends. */
export type Overview = Answer<"GET /api/overview">;

/** Files, collections and bytes; `measuredAt` says when an object store's were measured. */
export type Usage = Overview["usage"];

/**
 * A storage backend: whether it answered when the list was read and how (`status`), the bytes it
 * may hold where it knows its limit, its kind's configuration without secrets, and whether a
 * secret key is stored, which the API never returns.
 */
export type Backend = Answer<"GET /api/backends">[number];

/** How a backend answered when the list was read (packages/core listBackends). */
export type BackendStatus = Backend["status"];

/** A kind's configuration as the Dashboard sends it, such as an S3 endpoint and bucket. */
export type BackendConfig = Partial<Record<string, string | boolean>>;

/** A Mount; `root` is the folder of the backend it shows, "" for the whole backend. */
export type Mount = Answer<"GET /api/mounts">[number];

/**
 * An API Key: `start` is its first characters, which Better Auth keeps to tell keys apart; `paths`
 * the folders it is limited to, null for every mount; `lastUsedAt` when a WebDAV client last
 * signed in with it, to within a few minutes.
 */
export type ApiKey = Answer<"GET /api/keys">[number];

export type Access = ApiKey["access"];

/** The storage kinds this Dashboard can name; the API decides which a deployment offers. */
export const kindLabel = (t: Translator, kind: string): string => {
  switch (kind) {
    case "durable-object":
      return t("kind.durableObject");
    case "s3":
      return t("kind.s3");
    case "r2":
      return t("kind.r2");
    default:
      return kind;
  }
};

export const keys = {
  me: ["me"] as const,
  session: ["session"] as const,
  overview: ["overview"] as const,
  apiKeys: ["keys"] as const,
  backends: ["backends"] as const,
  mounts: ["mounts"] as const,
  /** Every WebDAV read starts with this key, so one invalidation refreshes them all. */
  dav: ["dav"] as const,
};

/**
 * One client for the visit. A call refused with 401 means the session ended: the session the
 * sign-in page reads becomes null, and /api/me is read again so the Dashboard sends the person to
 * sign in.
 */
export const createQueryClient = (): QueryClient => {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (!isUnauthorized(error)) return;
        // The session is over whatever the sign-in page last read, so it shows the form instead
        // of sending the person back to the page that was just refused.
        client.setQueryData(keys.session, null);
        if (query.queryKey[0] !== keys.me[0]) {
          void client.invalidateQueries({ queryKey: keys.me });
        }
      },
    }),
    defaultOptions: {
      queries: {
        staleTime: 10_000,
        // A refusal will not change on a second try; a dropped connection or a 5xx may.
        retry: (count, error) =>
          count < 2 && !(isApiError(error) && error.status >= 400 && error.status < 500),
      },
      mutations: { retry: false },
    },
  });
  return client;
};

let browserClient: QueryClient | undefined;

/**
 * The browser's one client for the visit, which client.tsx fills with the page's first reads before
 * the page renders. The prerender, which runs once per page, makes a client of its own each time.
 */
export const browserQueryClient = (): QueryClient => {
  browserClient ??= createQueryClient();
  return browserClient;
};

/** Starts the next visit with a client of its own, as a test that opens the Dashboard again needs. */
export const forgetBrowserQueryClient = (): void => {
  browserClient = undefined;
};

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => apiCall(() => api.me.get()),
  retry: (count, error) => count < 2 && !isApiError(error),
  staleTime: 60_000,
});

/**
 * Whether this browser is signed in, as Better Auth's session endpoint answers: 200 with the
 * session, or 200 with null. The sign-in page asks it rather than /api/me, whose 401 for a visitor
 * who is not signed in the browser reports as an error.
 */
export const sessionQuery = queryOptions({
  queryKey: keys.session,
  queryFn: () => authFetch<{ user: User } | null>("/api/auth/get-session"),
  retry: false,
});

export const useMe = () => useQuery(meQuery);

export const overviewQuery = queryOptions({
  queryKey: keys.overview,
  queryFn: () => apiCall(() => api.overview.get()),
});

export const apiKeysQuery = queryOptions({
  queryKey: keys.apiKeys,
  queryFn: () => apiCall(() => api.keys.get()),
});

export const backendsQuery = queryOptions({
  queryKey: keys.backends,
  queryFn: () => apiCall(() => api.backends.get()),
});

export const mountsQuery = queryOptions({
  queryKey: keys.mounts,
  queryFn: () => apiCall(() => api.mounts.get()),
});

export const useOverview = () => useQuery(overviewQuery);

export const useApiKeys = () => useQuery(apiKeysQuery);

export const useBackends = () => useQuery(backendsQuery);

export const useMounts = () => useQuery(mountsQuery);

/** After a change to storage, everything that shows storage reads it again. */
const useInvalidateStorage = () => {
  const client = useQueryClient();
  return () =>
    Promise.all([
      client.invalidateQueries({ queryKey: keys.mounts }),
      client.invalidateQueries({ queryKey: keys.backends }),
      client.invalidateQueries({ queryKey: keys.overview }),
      client.invalidateQueries({ queryKey: keys.dav }),
    ]);
};

export const useCreateKey = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: {
      name: string;
      access: Access;
      expiresInDays: number | null;
      paths?: string[];
    }) => apiCall(() => api.keys.post(input)),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
};

export const useRenameKey = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiCall(() => api.keys({ id }).patch({ name })),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
};

export const useRevokeKey = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.keys({ id }).delete()),
    onSettled: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
};

export const useCreateBackend = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (input: {
      name: string;
      kind: string;
      config?: BackendConfig;
      secretKey?: string;
    }) => apiCall(() => api.backends.post(input)),
    onSuccess: invalidate,
  });
};

export const useCreateMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (input: { name: string; backendId: string; root: string }) =>
      apiCall(() => api.mounts.post(input)),
    onSuccess: invalidate,
  });
};

export const useRenameMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiCall(() => api.mounts({ id }).patch({ name })),
    onSuccess: invalidate,
  });
};

/** Points a mount at another backend and folder, once its files are copied there. */
export const useMoveMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: ({ id, backendId, root }: { id: string; backendId: string; root: string }) =>
      apiCall(() => api.mounts({ id }).patch({ backendId, root })),
    onSuccess: invalidate,
  });
};

export const useRemoveMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.mounts({ id }).delete()),
    onSettled: invalidate,
  });
};

/** An export of this instance: the encrypted file and the key that opens it, shown once. */
export const exportInstance = () => apiCall(() => api.export.post());

// --- Overview operations, backend changes and checks, storage settings, about ---------------

/** The last 24 hours of WebDAV operations, oldest first, and the latest failed ones, newest first. */
export type Operations = Answer<"GET /api/operations">;

/** One hour of operations, starting at `start` (ISO 8601). */
export type OperationHour = Operations["hours"][number];

/** A failed operation: its path under /dav, and where a COPY or MOVE was to go. */
export type OperationError = Operations["errors"][number];

export type BackendCheck = Answer<"POST /api/backends/:id/verify">;

export type StorageSettings = Answer<"GET /api/settings/storage">;

/** Where this instance runs, and the storage kinds a new backend may take on it. */
export type InstanceInfo = Answer<"GET /api/instance">;

export const instanceKeys = {
  operations: ["operations"] as const,
  storageSettings: ["settings", "storage"] as const,
  instance: ["instance"] as const,
};

export const operationsQuery = queryOptions({
  queryKey: instanceKeys.operations,
  queryFn: () => apiCall(() => api.operations.get()),
  refetchInterval: 60_000,
});

export const storageSettingsQuery = queryOptions({
  queryKey: instanceKeys.storageSettings,
  queryFn: () => apiCall(() => api.settings.storage.get()),
});

export const instanceInfoQuery = queryOptions({
  queryKey: instanceKeys.instance,
  queryFn: () => apiCall(() => api.instance.get()),
  staleTime: 5 * 60_000,
});

export const useOperations = () => useQuery(operationsQuery);

export const useStorageSettings = () => useQuery(storageSettingsQuery);

export const useInstanceInfo = () => useQuery(instanceInfoQuery);

export const useSaveStorageSettings = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { defaultBackendId: string }) =>
      apiCall(() => api.settings.storage.put(input)),
    onSuccess: (saved) => client.setQueryData(instanceKeys.storageSettings, saved),
  });
};

export const useUpdateBackend = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: ({
      id,
      ...input
    }: {
      id: string;
      name: string;
      config?: BackendConfig;
      secretKey?: string;
    }) => apiCall(() => api.backends({ id }).patch(input)),
    onSuccess: invalidate,
  });
};

export const useRemoveBackend = () => {
  const client = useQueryClient();
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.backends({ id }).delete()),
    onSettled: () =>
      Promise.all([
        invalidate(),
        client.invalidateQueries({ queryKey: instanceKeys.storageSettings }),
      ]),
  });
};

/** Asks one backend whether it answers, then reads the backends again. */
export const useVerifyBackend = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (id: string) => apiCall(() => api.backends({ id }).verify.post()),
    onSettled: invalidate,
  });
};

/** Asks every backend whether it answers, then reads the backends again. */
export const useCheckBackends = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: () => apiCall(() => api.backends.check.post()),
    onSettled: invalidate,
  });
};
