import {
  registerOwner,
  registrationStatus,
  requireVerified,
  responseFromExit,
  reverify,
  exportInstance,
  importInstance,
  type Archive,
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
  retargetMount,
  requireUser,
  revokeKey,
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
import { authorizeScoped, verificationLevel, type ActionEffect } from "@davloom/laws";
import { createWebDavHandler, type LockStore, type WebDavHandler } from "@davloom/webdav";
import { Cause, Effect, Redacted, type Exit, type Layer } from "effect";
import { Elysia, type ElysiaAdapter } from "elysia";
import { parseBasicCredentials } from "@davloom/auth";
import {
  apiEffect,
  authEffect,
  davEffect,
  updateUserEffect,
  type RouteEffect,
} from "./verification";

/** The application's Ports, which every deployment provides. */
type Services = Records | Identity | StorageOpener | InstanceConfig | CredentialCipher | Archive;

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
  /**
   * Serves WebDAV and the API over plain HTTP to any host, for a trusted network
   * (DAVLOOM_ALLOW_HTTP=1). Without it, plain HTTP reaches them only on the machine itself.
   */
  readonly allowHttp?: boolean;
  /**
   * Classifies routes that a caller adds under /api/ after createApp, from the method and the
   * route's pattern, as API_ACTIONS does (apps/api/src/verification.ts). A route that neither
   * classifies answers 404.
   */
  readonly classify?: (method: string, route: string) => RouteEffect | undefined;
}

// PRD §12: WebDAV is exposed over HTTPS only. API Keys and session cookies travel with every
// request, so over plain HTTP anyone on the way could read them. A request that came over plain
// HTTP is refused unless it comes from the machine itself, or a proxy in front of Davloom says
// the client used HTTPS, or the deployment allows plain HTTP for a trusted network. A client that
// claims HTTPS through the header falsely only exposes its own credentials.
const LOOPBACK = /^(localhost|127(?:\.\d{1,3}){3}|\[::1\])$/i;

/** Whether a request reached Davloom over plain HTTP from another machine. */
export const isInsecure = (request: Request): boolean => {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    // A request without a usable Host, as HTTP/1.0 may send, names no machine.
    return true;
  }
  if (url.protocol !== "http:" || LOOPBACK.test(url.hostname)) return false;
  return request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase() !== "https";
};

const HTTPS_ONLY = () =>
  new Response(
    "Davloom serves WebDAV and its API over HTTPS only. Connect with https://, put a TLS proxy in front of Davloom, or set DAVLOOM_ALLOW_HTTP=1 for a trusted network.",
    { status: 403, headers: { "content-type": "text/plain; charset=utf-8" } },
  );

const notImplemented: WebDavHandler = () => new Response(null, { status: 501 });

const ERRORS = {
  RegistrationClosed: { status: 409, code: "registration_closed" },
  UsernameRefused: { status: 400, code: "username_refused" },
  PasswordRefused: { status: 400, code: "password_refused" },
  EmailRefused: { status: 400, code: "email_refused" },
  PasswordCheckFailed: { status: 503, code: "password_check_failed" },
  VerificationRequired: { status: 403, code: "verification_required" },
  WrongPassword: { status: 400, code: "wrong_password" },
  CodeRequired: { status: 400, code: "code_required" },
  WrongCode: { status: 400, code: "wrong_code" },
  InvalidInput: { status: 400, code: "invalid_input" },
  NotFound: { status: 404, code: "not_found" },
  NameTaken: { status: 409, code: "name_taken" },
  Unauthorized: { status: 401, code: "unauthorized" },
  MountInUse: { status: 409, code: "mount_in_use" },
  ArchiveInvalid: { status: 422, code: "archive_invalid" },
  CredentialsError: { status: 500, code: "credentials_error" },
} as const;
type ErrorTag = keyof typeof ERRORS;
const errors: ErrorResponses<{ _tag: ErrorTag }> = ERRORS;

const UNAUTHORIZED = () =>
  new Response(null, {
    status: 401,
    headers: { "www-authenticate": 'Basic realm="Davloom", charset="UTF-8"' },
  });

const NOT_CONFIGURED = () => Response.json({ error: { code: "not_configured" } }, { status: 503 });

/** A route or Better Auth path that has no entry in verification.ts. */
const UNCLASSIFIED = () => Response.json({ error: { code: "not_found" } }, { status: 404 });

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

export const createApp = ({
  adapter,
  instance,
  webdavHandler,
  allowHttp = false,
  classify = () => undefined,
}: AppOptions = {}) => {
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

  /**
   * The credential of a WebDAV request: an API Key by Basic Auth, or the Dashboard's session. A
   * session's request that needs step-up verification and has none gets the refusal instead.
   */
  const credentialOf = async (
    request: Request,
    current: NonNullable<ReturnType<typeof get>>,
  ): Promise<Credential | Response | null> => {
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
      const effect = davEffect(request.method, request.headers.get("overwrite"));
      const exit = await Effect.runPromiseExit(
        Effect.provide(
          requireVerified(request.headers, effect, Date.now()),
          current.instance.layer,
        ),
      );
      if (exit._tag === "Success") {
        return { keyId: `session:${exit.value.id}`, access: "read-write", scope: null };
      }
      const refused = responseFromExit(exit, { errors });
      return refused.status === 403 ? refused : null;
    }
    return null;
  };

  const webdav = async ({ request }: { request: Request }) => {
    if (webdavHandler) return await webdavHandler(request);
    const current = get(request);
    if (current === undefined) return await notImplemented(request);
    if (current === null) return NOT_CONFIGURED();
    const credential = await credentialOf(request, current);
    if (credential instanceof Response) return credential;
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

  /**
   * Refuses an action that needs step-up verification when the session has not proved presence
   * within the window (packages/laws verification.bend); undefined when it may run.
   */
  const refuseUnverified = async (
    request: Request,
    effect: ActionEffect,
  ): Promise<Response | undefined> => {
    if (verificationLevel(effect) !== "step-up") return undefined;
    const current = get(request);
    if (current === undefined) return new Response(null, { status: 501 });
    if (current === null) return NOT_CONFIGURED();
    const exit = await Effect.runPromiseExit(
      Effect.provide(requireVerified(request.headers, effect, Date.now()), current.instance.layer),
    );
    return exit._tag === "Success" ? undefined : responseFromExit(exit, { errors });
  };

  /** Better Auth's routes, limited to the paths verification.ts names. */
  const authRoute = async ({ request }: { request: Request }) => {
    const current = get(request);
    if (!current) return new Response(null, { status: 501 });
    const path = new URL(request.url).pathname.slice("/api/auth".length);
    let effect = authEffect(path);
    if (effect === undefined) return UNCLASSIFIED();
    if (path === "/update-user") {
      effect = updateUserEffect(
        await request
          .clone()
          .json()
          .catch(() => null),
      );
    }
    if (effect !== "public") {
      const refused = await refuseUnverified(request, effect);
      if (refused) return refused;
    }
    return await current.instance.authHandler(request);
  };

  return (
    new Elysia(adapter ? { adapter } : {})
      .onRequest(({ request }) => {
        if (allowHttp || !isInsecure(request)) return undefined;
        const pathname = URL.canParse(request.url) ? new URL(request.url).pathname : "/api";
        // The health check carries no credential, and load balancers often probe it over HTTP.
        if (pathname === "/api/health" || pathname === "/api/health/") return undefined;
        return /^\/(api|dav)(\/|$)/.test(pathname) ? HTTPS_ONLY() : undefined;
      })
      // Every route below names its effect in verification.ts; one that does not is refused, and
      // a step-up action without a fresh verification answers 403 verification_required.
      .onBeforeHandle(async ({ request, route }) => {
        // WebDAV and Better Auth classify their own requests below; a route outside /api/, such
        // as the Bun entry's Dashboard files, serves pages and changes nothing.
        if (!route.startsWith("/api/") || route === "/api/auth/*") return undefined;
        const method = request.method === "HEAD" ? "GET" : request.method;
        const effect = apiEffect(method, route) ?? classify(method, route);
        if (effect === undefined) return UNCLASSIFIED();
        return effect === "public" ? undefined : await refuseUnverified(request, effect);
      })
      .get("/api/health", () => ({ status: "ok" }))
      .all("/api/auth/*", authRoute, { parse: "none" })
      // --- Registration and step-up verification -------------------------------------------
      .get(
        "/api/registration",
        api(() => registrationStatus),
      )
      .post(
        "/api/registration",
        api(
          (request) =>
            Effect.flatMap(
              Effect.promise(() => readJson(request)),
              (body) =>
                Effect.tap(
                  registerOwner({
                    username: text(body.username),
                    name: text(body.name),
                    email: text(body.email),
                    password: text(body.password),
                  }),
                  () => Effect.sync(invalidate),
                ),
            ),
          201,
        ),
        { parse: "none" },
      )
      .post(
        "/api/registration/import",
        api(
          (request) =>
            Effect.flatMap(
              Effect.promise(() => readJson(request)),
              (body) =>
                Effect.tap(importInstance({ key: text(body.key), file: body.file }), () =>
                  Effect.sync(invalidate),
                ),
            ),
          201,
        ),
        { parse: "none" },
      )
      .post(
        "/api/verify",
        api((request) =>
          Effect.flatMap(
            Effect.promise(() => readJson(request)),
            (body) =>
              reverify(request.headers, { password: text(body.password), code: text(body.code) }),
          ),
        ),
        { parse: "none" },
      )
      .post(
        "/api/export",
        authed(() =>
          Effect.map(exportInstance, ({ key, file }) => ({ key: Redacted.value(key), file })),
        ),
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
                Effect.tap(
                  // A body with a backend points the Mount there; otherwise it renames it.
                  typeof body.backendId === "string"
                    ? retargetMount(params.id, { backendId: body.backendId, root: text(body.root) })
                    : renameMount(params.id, text(body.name)),
                  () => Effect.sync(invalidate),
                ),
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
