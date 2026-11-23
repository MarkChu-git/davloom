import { startWorkerdServer, type Server } from "./servers";

// Starts the production Worker in local workerd with an administrator, and gives the tests an API
// Key of each access level.

export const SETUP_TOKEN = "local-setup-token-for-tests";
export const SECRET = "local-instance-secret-for-tests-only-0123456789";
export const ADMIN = {
  name: "Admin",
  email: "admin@example.com",
  password: "correct horse battery staple",
};

export interface Davloom {
  readonly server: Server;
  /** The Cookie header of the signed-in administrator. */
  readonly cookie: string;
  readonly readWriteKey: string;
  readonly readOnlyKey: string;
  /** Fetches /dav with Basic Auth. */
  readonly dav: (path: string, init?: RequestInit & { key?: string }) => Promise<Response>;
  readonly api: (path: string, init?: RequestInit) => Promise<Response>;
}

/** A string field of a JSON object, or a failed test. */
export const stringField = (value: unknown, name: string): string => {
  const field: unknown =
    typeof value === "object" && value !== null ? Reflect.get(value, name) : undefined;
  if (typeof field !== "string") throw new Error(`no string ${name} in ${JSON.stringify(value)}`);
  return field;
};

const mergeHeaders = (base: Record<string, string>, extra: HeadersInit | undefined) => {
  const headers = new Headers(base);
  new Headers(extra).forEach((value, name) => headers.set(name, value));
  return headers;
};

export const basic = (key: string) => `Basic ${btoa(`davloom:${key}`)}`;

/** The production Worker in local workerd: D1 and Durable Objects. */
export const startWorkersServer = () =>
  startWorkerdServer("apps/api/wrangler.jsonc", {
    vars: { DAVLOOM_SECRET: SECRET, DAVLOOM_SETUP_TOKEN: SETUP_TOKEN },
  });

/** Starts a server, creates its administrator, signs in and makes an API Key of each access level. */
export const startDavloom = async (
  start: () => Promise<Server> = startWorkersServer,
): Promise<Davloom> => {
  const server = await start();
  const setup = await server.fetch("/api/setup", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...ADMIN, token: SETUP_TOKEN }),
  });
  if (setup.status !== 201) throw new Error(`setup failed: ${setup.status} ${await setup.text()}`);
  const signIn = await server.fetch("/api/auth/sign-in/email", {
    method: "POST",
    headers: { "content-type": "application/json", origin: server.url },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  });
  if (!signIn.ok) throw new Error(`sign-in failed: ${signIn.status} ${await signIn.text()}`);
  const cookie = signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
  const api = (path: string, init: RequestInit = {}) =>
    server.fetch(path, {
      ...init,
      headers: mergeHeaders(
        { "content-type": "application/json", origin: server.url, cookie },
        init.headers,
      ),
    });
  const key = async (access: string) => {
    const response = await api("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: access, access }),
    });
    if (response.status !== 201)
      throw new Error(`key failed: ${response.status} ${await response.text()}`);
    return stringField(await response.json(), "key");
  };
  const readWriteKey = await key("read-write");
  const readOnlyKey = await key("read-only");
  const dav = (
    path: string,
    { key: k = readWriteKey, ...init }: RequestInit & { key?: string } = {},
  ) =>
    server.fetch(`/dav${path}`, {
      ...init,
      headers: mergeHeaders({ authorization: basic(k) }, init.headers),
    });
  return { server, cookie, readWriteKey, readOnlyKey, dav, api };
};
