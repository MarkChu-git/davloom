import {
  QueryCache,
  QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import type { Translator } from "../i18n/translate";
import { apiFetch, isApiError, isUnauthorized } from "./client";

// Server state of the Dashboard, read and changed through TanStack Query. The shapes are the JSON
// answers of apps/api/src/app.ts.

export interface User {
  id: string;
  /** The display name. */
  name: string;
  /** The username the owner signs in with; null for an owner from an export without one. */
  username: string | null;
  /** The owner's email, or null when they gave none. */
  email: string | null;
  twoFactorEnabled: boolean;
  /** When this session last proved presence, in milliseconds since the epoch. */
  verifiedAt: number;
}

export interface Usage {
  files: number;
  collections: number;
  bytes: number;
  /** When an object store's counts were measured (ms since the epoch); absent when current. */
  measuredAt?: number;
}

export interface Backend {
  id: string;
  name: string;
  kind: string;
  createdAt: string;
  /** Whether the backend answered when the list was read. */
  available: boolean;
  usage: Usage | null;
  /** How the backend answered then; absent from an older server. */
  status?: BackendStatus;
  /** The bytes the backend may hold in all, where it knows its limit. */
  capacity?: number | null;
  /** The kind's configuration without secrets, such as an S3 endpoint and bucket. */
  config?: BackendConfig;
  /** Whether a secret key is stored; the API never returns it. */
  hasSecretKey?: boolean;
}

/** How a backend answered when the list was read (packages/core listBackends). */
export type BackendStatus =
  | { state: "answered"; ms: number }
  | { state: "failed"; failure: string; ms: number }
  | { state: "not-opened" };

export type BackendConfig = Partial<Record<string, string | boolean>>;

export interface Mount {
  id: string;
  name: string;
  backendId: string;
  backendKind: string;
  /** The folder of the backend the Mount shows, "" for the whole backend. */
  root: string;
  createdAt: string;
}

export interface Overview {
  usage: Usage;
  mounts: Mount[];
  backends: Backend[];
}

export type Access = "read-only" | "read-write";

export interface ApiKey {
  id: string;
  name: string;
  /** The key's first characters, which Better Auth keeps to tell keys apart. */
  start: string | null;
  access: Access;
  /** The folders the key is limited to, such as /files/photos; null for every mount. */
  paths: string[] | null;
  enabled: boolean;
  expiresAt: string | null;
  createdAt: string;
  /** When a WebDAV client last signed in with it, to within a few minutes; null for never. */
  lastUsedAt: string | null;
}

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
  queryFn: () => apiFetch<User>("/api/me"),
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
  queryFn: () => apiFetch<{ user: User } | null>("/api/auth/get-session"),
  retry: false,
});

export const useMe = () => useQuery(meQuery);

export const overviewQuery = queryOptions({
  queryKey: keys.overview,
  queryFn: () => apiFetch<Overview>("/api/overview"),
});

export const apiKeysQuery = queryOptions({
  queryKey: keys.apiKeys,
  queryFn: () => apiFetch<ApiKey[]>("/api/keys"),
});

export const backendsQuery = queryOptions({
  queryKey: keys.backends,
  queryFn: () => apiFetch<Backend[]>("/api/backends"),
});

export const mountsQuery = queryOptions({
  queryKey: keys.mounts,
  queryFn: () => apiFetch<Mount[]>("/api/mounts"),
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
    }) => apiFetch<{ id: string; key: string }>("/api/keys", { method: "POST", body: input }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
};

export const useRenameKey = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<{ id: string; name: string }>(`/api/keys/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { name },
      }),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.apiKeys }),
  });
};

export const useRevokeKey = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/api/keys/${encodeURIComponent(id)}`, { method: "DELETE" }),
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
    }) => apiFetch<{ id: string }>("/api/backends", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
};

export const useCreateMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (input: { name: string; backendId: string; root: string }) =>
      apiFetch<{ id: string }>("/api/mounts", { method: "POST", body: input }),
    onSuccess: invalidate,
  });
};

export const useRenameMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: ({ id, name }: { id: string; name: string }) =>
      apiFetch<{ id: string }>(`/api/mounts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { name },
      }),
    onSuccess: invalidate,
  });
};

/** Points a mount at another backend and folder, once its files are copied there. */
export const useMoveMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: ({ id, backendId, root }: { id: string; backendId: string; root: string }) =>
      apiFetch<{ id: string }>(`/api/mounts/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: { backendId, root },
      }),
    onSuccess: invalidate,
  });
};

export const useRemoveMount = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string }>(`/api/mounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
    onSettled: invalidate,
  });
};

/** An export of this instance: the encrypted file and the key that opens it, shown once. */
export const exportInstance = () =>
  apiFetch<{ key: string; file: unknown }>("/api/export", { method: "POST" });

// --- Overview operations, backend changes and checks, storage settings, about ---------------

export interface OperationHour {
  /** The hour's start, as ISO 8601. */
  start: string;
  operations: number;
  failed: number;
}

export interface OperationError {
  id: string;
  at: string;
  method: string;
  /** The path under /dav, such as /files/report.pdf. */
  path: string;
  /** Where a COPY or MOVE was to go, under /dav. */
  destination: string | null;
  status: number;
}

export interface Operations {
  /** The last 24 hours, oldest first. */
  hours: OperationHour[];
  /** The latest failed operations among them, newest first. */
  errors: OperationError[];
}

export interface BackendCheck {
  id: string;
  name: string;
  available: boolean;
  latencyMs: number | null;
  reason: string | null;
  checkedAt: string;
}

export interface StorageSettings {
  defaultBackendId: string | null;
}

export interface InstanceInfo {
  version: string;
  commit: string | null;
  runtime: string;
  deployment: string;
  region: string | null;
  database: string;
  /** The storage kinds a new backend may take on this instance. */
  storageKinds: string[];
}

export const instanceKeys = {
  operations: ["operations"] as const,
  storageSettings: ["settings", "storage"] as const,
  instance: ["instance"] as const,
};

export const operationsQuery = queryOptions({
  queryKey: instanceKeys.operations,
  queryFn: () => apiFetch<Operations>("/api/operations"),
  refetchInterval: 60_000,
});

export const storageSettingsQuery = queryOptions({
  queryKey: instanceKeys.storageSettings,
  queryFn: () => apiFetch<StorageSettings>("/api/settings/storage"),
});

export const instanceInfoQuery = queryOptions({
  queryKey: instanceKeys.instance,
  queryFn: () => apiFetch<InstanceInfo>("/api/instance"),
  staleTime: 5 * 60_000,
});

export const useOperations = () => useQuery(operationsQuery);

export const useStorageSettings = () => useQuery(storageSettingsQuery);

export const useInstanceInfo = () => useQuery(instanceInfoQuery);

export const useSaveStorageSettings = () => {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (input: { defaultBackendId: string }) =>
      apiFetch<StorageSettings>("/api/settings/storage", { method: "PUT", body: input }),
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
    }) =>
      apiFetch<{ id: string }>(`/api/backends/${encodeURIComponent(id)}`, {
        method: "PATCH",
        body: input,
      }),
    onSuccess: invalidate,
  });
};

export const useRemoveBackend = () => {
  const client = useQueryClient();
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: (id: string) =>
      apiFetch<{ id: string; filesKept: boolean }>(`/api/backends/${encodeURIComponent(id)}`, {
        method: "DELETE",
      }),
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
    mutationFn: (id: string) =>
      apiFetch<BackendCheck>(`/api/backends/${encodeURIComponent(id)}/verify`, {
        method: "POST",
      }),
    onSettled: invalidate,
  });
};

/** Asks every backend whether it answers, then reads the backends again. */
export const useCheckBackends = () => {
  const invalidate = useInvalidateStorage();
  return useMutation({
    mutationFn: () => apiFetch<BackendCheck[]>("/api/backends/check", { method: "POST" }),
    onSettled: invalidate,
  });
};
