import {
  completeSetup,
  createBackend,
  createKey,
  createMount,
  listBackends,
  listKeys,
  listMounts,
  makeHttpRunner,
  openNamespace,
  removeMount,
  renameMount,
  requireUser,
  revokeKey,
  setupStatus,
  verifyApiKey,
  relationOf,
  scopeStorage,
  type StorageBackend,
  instanceUsage,
  type Credential,
  type ErrorResponses,
  type Records,
  type Identity,
  type StorageOpener,
  type InstanceConfig,
  type CredentialCipher,
} from "@davloom/core";
import { authorizeScoped } from "@davloom/laws";
import { createWebDavHandler, type LockStore, type WebDavHandler } from "@davloom/webdav";
import { Cause, Effect, type Exit, type Layer } from "effect";
import { Elysia, type ElysiaAdapter } from "elysia";
import { parseBasicCredentials } from "@davloom/auth";

/** The application's Ports, which every deployment provides. */
type Services = Records | Identity | StorageOpener | InstanceConfig | CredentialCipher;

/** What a deployment provides: the Layer of the application's Ports, Better Auth and the locks. */
export interface Instance {
  readonly layer: Layer.Layer<Services>;
  /** Better Auth's own routes under /api/auth. */
  readonly authHandler: (request: Request) => Promise<Response>;
  readonly locks: LockStore;
}

export interface AppOptions {
  /** Elysia picks its Bun adapter by default. Workers must pass the Cloudflare adapter. */
  readonly adapter?: ElysiaAdapter;
  /**
   * Builds the instance on first use, from the first request's origin; Workers can only do IO
   * while handling a request.
   */
  readonly instance?: (origin: string) => Instance;
  /** Replaces the WebDAV handler; the compatibility probe passes its own. */
  readonly webdavHandler?: WebDavHandler;
}

const notImplemented: WebDavHandler = () => new Response(null, { status: 501 });

const ERRORS = {
  SetupClosed: { status: 409, code: "setup_closed" },
  SetupTokenInvalid: { status: 403, code: "setup_token_invalid" },
  InvalidInput: { status: 400, code: "invalid_input" },
  NotFound: { status: 404, code: "not_found" },
  NameTaken: { status: 409, code: "name_taken" },
  Unauthorized: { status: 401, code: "unauthorized" },
  MountInUse: { status: 409, code: "mount_in_use" },
} as const;
type ErrorTag = keyof typeof ERRORS;
const errors: ErrorResponses<{ _tag: ErrorTag }> = ERRORS;

const UNAUTHORIZED = () =>
  new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Davloom", charset="UTF-8"' },
  });

const NOT_CONFIGURED = () => Response.json({ error: { code: "not_configured" } }, { status: 503 });

/** The header that marks a Dashboard request, which a cross-site form cannot send. */
export const DASHBOARD_HEADER = "x-davloom-dashboard";

// API Keys a WebDAV client sent recently, by key, so a burst of requests costs one database read.
// A revoked key keeps working in an isolate that cached it for at most this long.
const CREDENTIAL_TTL_MS = 30_000;
const NAMESPACE_TTL_MS = 5_000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readJson = async (request: Request): Promise<Record<string, unknown>> => {
  try {
    const value: unknown = await request.json();
    return isRecord(value) ? value : {};
  } catch {
    return {};
  }
};
const text = (value: unknown) => (typeof value === "string" ? value : "");

export const createApp = ({ adapter, instance, webdavHandler }: AppOptions = {}) => {
  let built:
    | {
        instance: Instance;
        run: ReturnType<typeof makeHttpRunner<Services>>;
      }
    | undefined;
  const get = (request: Request) => {
    if (!instance) return undefined;
    if (!built) {
      try {
        const current = instance(new URL(request.url).origin);
        built = { instance: current, run: makeHttpRunner(current.layer) };
      } catch (error) {
        console.error("Davloom is not configured:", error instanceof Error ? error.message : error);
        return null;
      }
    }
    return built;
  };
  const credentials = new Map<string, { credential: Credential | null; until: number }>();
  let namespace:
    | {
        handlerFor: Map<string, WebDavHandler>;
        storage?: Exit.Exit<StorageBackend, unknown>;
        until: number;
      }
    | undefined;

  const api =
    (
      program: (request: Request) => Effect.Effect<unknown, { _tag: ErrorTag }, Services>,
      status = 200,
    ) =>
    async ({ request }: { request: Request }) => {
      const current = get(request);
      if (current === undefined) return new Response(null, { status: 501 });
      if (current === null) return NOT_CONFIGURED();
      return await current.run(program(request), {
        errors,
        successStatus: status,
        onDefect: (cause) => console.error(Cause.pretty(cause)),
      });
    };
  const authed = <A>(
    program: (
      user: { id: string },
      request: Request,
    ) => Effect.Effect<A, { _tag: ErrorTag }, Services>,
    status = 200,
  ) =>
    api(
      (request) => Effect.flatMap(requireUser(request.headers), (user) => program(user, request)),
      status,
    );

  /** The credential of a WebDAV request: an API Key by Basic Auth, or the Dashboard's session. */
  const credentialOf = async (
    request: Request,
    current: NonNullable<ReturnType<typeof get>>,
  ): Promise<Credential | null> => {
    const basic = parseBasicCredentials(request.headers.get("authorization"));
    if (basic) {
      const now = Date.now();
      const cached = credentials.get(basic.password);
      if (cached && cached.until > now) return cached.credential;
      const exit = await Effect.runPromiseExit(
        Effect.provide(verifyApiKey(basic.password, now), current.instance.layer),
      );
      const credential = exit._tag === "Success" ? exit.value : null;
      if (credentials.size > 1000) credentials.clear();
      credentials.set(basic.password, { credential, until: now + CREDENTIAL_TTL_MS });
      return credential;
    }
    if (request.headers.get(DASHBOARD_HEADER) === "1") {
      const exit = await Effect.runPromiseExit(
        Effect.provide(requireUser(request.headers), current.instance.layer),
      );
      return exit._tag === "Success"
        ? { keyId: `session:${exit.value.id}`, access: "read-write", scope: null }
        : null;
    }
    return null;
  };

  const webdav = async ({ request }: { request: Request }) => {
    if (webdavHandler) return await webdavHandler(request);
    const current = get(request);
    if (current === undefined) return await notImplemented(request);
    if (current === null) return NOT_CONFIGURED();
    const credential = await credentialOf(request, current);
    // The Dashboard signs in with its own page; a Basic challenge would open the browser's dialog.
    if (!credential) {
      return request.headers.get(DASHBOARD_HEADER) === "1"
        ? new Response(null, { status: 401 })
        : UNAUTHORIZED();
    }
    const now = Date.now();
    if (!namespace || namespace.until <= now)
      namespace = { handlerFor: new Map(), until: now + NAMESPACE_TTL_MS };
    // One handler per access level and scope; the namespace itself is read once for all of them.
    const cacheKey = JSON.stringify([credential.access, credential.scope]);
    let handler = namespace.handlerFor.get(cacheKey);
    if (!handler) {
      const cache = namespace;
      cache.storage ??= await Effect.runPromiseExit(
        Effect.provide(openNamespace, current.instance.layer),
      );
      // Read from the cache this request filled: another request may have replaced `namespace`.
      const opened = cache.storage;
      if (opened._tag !== "Success") return new Response(null, { status: 503 });
      const { access, scope } = credential;
      handler = createWebDavHandler({
        basePath: "/dav",
        storage: scopeStorage(opened.value, scope),
        locks: current.instance.locks,
        authorize: ({ method, target, destination }) =>
          authorizeScoped({
            access,
            method,
            target: relationOf(target, scope),
            destination: destination === null ? "outside" : relationOf(destination, scope),
          }),
      });
      cache.handlerFor.set(cacheKey, handler);
    }
    return await handler(request);
  };
  const invalidate = () => {
    namespace = undefined;
  };

  return (
    new Elysia(adapter ? { adapter } : {})
      .get("/api/health", () => ({ status: "ok" }))
      .all(
        "/api/auth/*",
        async ({ request }) => {
          const current = get(request);
          return current
            ? await current.instance.authHandler(request)
            : new Response(null, { status: 501 });
        },
        { parse: "none" },
      )
      .get(
        "/api/setup",
        api(() => setupStatus),
      )
      .post(
        "/api/setup",
        api(
          (request) =>
            Effect.flatMap(
              Effect.promise(() => readJson(request)),
              (body) =>
                Effect.tap(
                  completeSetup({
                    name: text(body.name),
                    email: text(body.email),
                    password: text(body.password),
                    token: text(body.token),
                  }),
                  () => Effect.sync(invalidate),
                ),
            ),
          201,
        ),
        { parse: "none" },
      )
      .get(
        "/api/me",
        authed((user) => Effect.succeed(user)),
      )
      .get(
        "/api/overview",
        authed(() =>
          Effect.all({ usage: instanceUsage, mounts: listMounts, backends: listBackends }),
        ),
      )
      .get(
        "/api/keys",
        authed(() => listKeys),
      )
      .post(
        "/api/keys",
        authed(
          (user, request) =>
            Effect.flatMap(
              Effect.promise(() => readJson(request)),
              (body) =>
                createKey(user.id, {
                  name: text(body.name),
                  access: text(body.access),
                  expiresInDays: typeof body.expiresInDays === "number" ? body.expiresInDays : null,
                  paths: body.paths,
                }),
            ),
          201,
        ),
        { parse: "none" },
      )
      .delete("/api/keys/:id", ({ params, request }) =>
        authed(() =>
          Effect.tap(revokeKey(params.id), () => Effect.sync(() => credentials.clear())),
        )({ request }),
      )
      .get(
        "/api/backends",
        authed(() => listBackends),
      )
      .post(
        "/api/backends",
        authed(
          (_, request) =>
            Effect.flatMap(
              Effect.promise(() => readJson(request)),
              (body) =>
                createBackend({
                  name: text(body.name),
                  kind: text(body.kind) || "durable-object",
                  config: body.config,
                  secretKey: text(body.secretKey),
                }),
            ),
          201,
        ),
        { parse: "none" },
      )
      .get(
        "/api/mounts",
        authed(() => listMounts),
      )
      .post(
        "/api/mounts",
        authed(
          (_, request) =>
            Effect.flatMap(
              Effect.promise(() => readJson(request)),
              (body) =>
                Effect.tap(
                  createMount({
                    name: text(body.name),
                    backendId: text(body.backendId),
                    root: text(body.root),
                  }),
                  () => Effect.sync(invalidate),
                ),
            ),
          201,
        ),
        { parse: "none" },
      )
      .patch(
        "/api/mounts/:id",
        ({ params, request }) =>
          authed((_, req) =>
            Effect.flatMap(
              Effect.promise(() => readJson(req)),
              (body) =>
                Effect.tap(renameMount(params.id, text(body.name)), () => Effect.sync(invalidate)),
            ),
          )({ request }),
        { parse: "none" },
      )
      .delete("/api/mounts/:id", ({ params, request }) =>
        authed(() => Effect.tap(removeMount(params.id), () => Effect.sync(invalidate)))({
          request,
        }),
      )
      // Elysia must leave the body unread and the path undecoded: the handler gets the raw request.
      .all("/dav", webdav, { parse: "none" })
      .all("/dav/*", webdav, { parse: "none" })
  );
};
