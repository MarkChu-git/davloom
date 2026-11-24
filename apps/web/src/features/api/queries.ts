import {
  QueryCache,
  QueryClient,
  queryOptions,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";
import { apiFetch, isApiError, isUnauthorized } from "./client";

// Server state of the Dashboard, read and changed through TanStack Query. The shapes are the JSON
// answers of apps/api/src/app.ts.

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface SetupStatus {
  /** No administrator exists yet. */
  needed: boolean;
  /** Setup is needed and the deployment set a setup token, so the form can complete it. */
  open: boolean;
}

export interface Usage {
  files: number;
  collections: number;
  bytes: number;
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
}

/** How a backend answered when the list was read (packages/core listBackends). */
export type BackendStatus =
  | { state: "answered"; ms: number }
  | { state: "failed"; failure: string; ms: number }
  | { state: "not-opened" };

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
export const BACKEND_KINDS: Record<string, string> = {
  "durable-object": "Cloudflare Durable Objects",
};

export const kindLabel = (kind: string): string => BACKEND_KINDS[kind] ?? kind;

export const keys = {
  me: ["me"] as const,
  setup: ["setup"] as const,
  overview: ["overview"] as const,
  apiKeys: ["keys"] as const,
  backends: ["backends"] as const,
  mounts: ["mounts"] as const,
  /** Every WebDAV read starts with this key, so one invalidation refreshes them all. */
  dav: ["dav"] as const,
};

/**
 * One client for the visit. A call refused with 401 everywhere but /api/me means the session
 * ended, so the session is read again and the Dashboard sends the person to sign in.
 */
export const createQueryClient = (): QueryClient => {
  const client: QueryClient = new QueryClient({
    queryCache: new QueryCache({
      onError: (error, query) => {
        if (isUnauthorized(error) && query.queryKey[0] !== keys.me[0]) {
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

export const meQuery = queryOptions({
  queryKey: keys.me,
  queryFn: () => apiFetch<User>("/api/me"),
  retry: (count, error) => count < 2 && !isApiError(error),
  staleTime: 60_000,
});

export const setupQuery = queryOptions({
  queryKey: keys.setup,
  queryFn: () => apiFetch<SetupStatus>("/api/setup"),
  retry: false,
});

export const useMe = () => useQuery(meQuery);

export const useOverview = () =>
  useQuery({ queryKey: keys.overview, queryFn: () => apiFetch<Overview>("/api/overview") });

export const useApiKeys = () =>
  useQuery({ queryKey: keys.apiKeys, queryFn: () => apiFetch<ApiKey[]>("/api/keys") });

export const useBackends = () =>
  useQuery({ queryKey: keys.backends, queryFn: () => apiFetch<Backend[]>("/api/backends") });

export const useMounts = () =>
  useQuery({ queryKey: keys.mounts, queryFn: () => apiFetch<Mount[]>("/api/mounts") });

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
    mutationFn: (input: { name: string; kind: string }) =>
      apiFetch<{ id: string }>("/api/backends", { method: "POST", body: input }),
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

/** Signs in with Better Auth's email and password route, which sets the session cookie. */
export const signIn = (email: string, password: string) =>
  apiFetch<unknown>("/api/auth/sign-in/email", { method: "POST", body: { email, password } });

export const signOut = () => apiFetch<unknown>("/api/auth/sign-out", { method: "POST", body: {} });

export const completeSetup = (input: {
  name: string;
  email: string;
  password: string;
  token: string;
}) => apiFetch<{ userId: string }>("/api/setup", { method: "POST", body: input });

/** An export of this instance: the encrypted file and the key that opens it, shown once. */
export const exportInstance = () =>
  apiFetch<{ key: string; file: unknown }>("/api/export", { method: "POST" });

/** Imports an export into this instance in place of the first-run setup. */
export const importInstance = (input: { token: string; key: string; file: unknown }) =>
  apiFetch<Record<string, number>>("/api/setup/import", { method: "POST", body: input });
