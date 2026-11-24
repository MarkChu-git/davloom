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
  renameKey,
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
  checkBackends,
  davPathOf,
  operationSummary,
  saveStorageSettings,
  storageSettings,
  updateBackend,
  verifyBackend,
  removeBackend,
  type InstanceSettings,
  type OperationLog,
  type OperationSample,
  auditPage,
  keyStartOf,
  recordAudit,
  type AuditEntry,
  type AuditLog,
  type RefusedCredential,
} from "@davloom/core";
import {
  decodeBody,
  type BodyInvalid,
  type BodyNotJson,
  decodeQuery,
  encodeWith,
  openApiDocument,
  ROUTES,
  type RouteName,
} from "@davloom/schema";
import {
  InstanceConfig as InstanceConfigService,
  redactedError,
  redactedStack,
} from "@davloom/core";
import { buildInfo } from "./build-info";
import { crossSiteRefusal } from "./same-origin";
import { authorizeScoped, verificationLevel, type ActionEffect } from "@davloom/laws";
import { createWebDavHandler, type LockStore, type WebDavHandler } from "@davloom/webdav";
import { Cause, Effect, Redacted, type Exit, type Layer, type Schema } from "effect";
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
type Services =
  | Records
  | Identity
  | StorageOpener
  | InstanceConfig
  | CredentialCipher
  | Archive
  | OperationLog
  | InstanceSettings
  | AuditLog;

/** What a deployment provides: the Layer of the application's Ports, Better Auth and the locks. */
export interface Instance {
  readonly layer: Layer.Layer<Services>;
  /** Better Auth's own routes under /api/auth. */
  readonly authHandler: (request: Request) => Promise<Response>;
  readonly locks: LockStore;
  /** Counts each WebDAV operation for the Overview; absent where nothing is counted. */
  readonly operations?: { readonly record: (sample: OperationSample) => void };
  /** Where this instance runs, for About this instance. */
  readonly about?: (request: Request) => InstanceAbout;
  /** The client's address as the deployment knows it, for the audit trail; else null. */
  readonly clientAddress?: (request: Request) => string | null;
  /** Counts refused WebDAV credentials for the audit trail; absent where nothing is counted. */
  readonly refusedCredentials?: { readonly refused: (credential: RefusedCredential) => void };
}

/** Where an instance runs, as About this instance shows it. */
export interface InstanceAbout {
  readonly runtime: string;
  readonly deployment: string;
  readonly region: string | null;
  readonly database: string;
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
   * The instance's public origin from its configuration (DAVLOOM_URL). An /api request that
   * changes something must come from it; without one, from the origin the request was sent to.
   */
  readonly publicOrigin?: string | undefined;
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
  SetupTokenInvalid: { status: 403, code: "setup_token_invalid" },
  UsernameRefused: { status: 400, code: "username_refused" },
  PasswordRefused: { status: 400, code: "password_refused" },
  EmailRefused: { status: 400, code: "email_refused" },
  PasswordCheckFailed: { status: 503, code: "password_check_failed" },
  VerificationRequired: { status: 403, code: "verification_required" },
  WrongPassword: { status: 400, code: "wrong_password" },
  CodeRequired: { status: 400, code: "code_required" },
  WrongCode: { status: 400, code: "wrong_code" },
  VerificationLocked: { status: 429, code: "verification_locked" },
  InvalidInput: { status: 400, code: "invalid_input" },
  NotFound: { status: 404, code: "not_found" },
  NameTaken: { status: 409, code: "name_taken" },
  Unauthorized: { status: 401, code: "unauthorized" },
  MountInUse: { status: 409, code: "mount_in_use" },
  ArchiveInvalid: { status: 422, code: "archive_invalid" },
  CredentialsError: { status: 500, code: "credentials_error" },
  BackendInUse: { status: 409, code: "backend_in_use" },
  BackendNotEmpty: { status: 409, code: "backend_not_empty" },
  BackendUnavailable: { status: 503, code: "backend_unavailable" },
  BodyNotJson: { status: 400, code: "invalid_json" },
  BodyInvalid: { status: 422, code: "invalid_body" },
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

/** The routes that take a JSON body, by `METHOD pattern`. */
type BodyRoute = {
  [Name in RouteName]: (typeof ROUTES)[Name] extends { body: unknown } ? Name : never;
}[RouteName];

/** Decodes a request's body with its route's schema (packages/schema). */
const bodyOf = <Name extends BodyRoute>(
  name: Name,
  request: Request,
): Effect.Effect<(typeof ROUTES)[Name]["body"]["Type"], BodyNotJson | BodyInvalid> =>
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route's own body schema
  decodeBody(ROUTES[name].body as Schema.Codec<(typeof ROUTES)[Name]["body"]["Type"]>, request);

/** The OpenAPI document, built on its first request. */
let openApi: Record<string, unknown> | undefined;

/** Whether a sign-in's second step carries the cookie that its first step set (Better Auth). */
const isSecondStep = (request: Request) =>
  /(?:^|;\s*)(?:__Secure-)?better-auth\.two_factor=/.test(request.headers.get("cookie") ?? "");

/** The events of Better Auth paths other than sign-ins, recorded when they succeed. */
const AUTH_CHANGES: Readonly<Record<string, AuditEntry>> = {
  "/sign-out": { action: "sign-out" },
  "/change-password": { action: "password", target: "changed" },
  "/change-email": { action: "email", target: "changed" },
  "/two-factor/disable": { action: "two-factor", target: "disabled" },
  "/two-factor/generate-backup-codes": { action: "two-factor", target: "backup codes" },
  "/passkey/verify-registration": { action: "passkey", target: "added" },
  "/passkey/update-passkey": { action: "passkey", target: "renamed" },
  "/passkey/delete-passkey": { action: "passkey", target: "removed" },
  "/revoke-session": { action: "sessions", target: "one" },
  "/revoke-sessions": { action: "sessions", target: "all" },
  "/revoke-other-sessions": { action: "sessions", target: "others" },
};

/**
 * The audit event of a Better Auth path, from its request and answer; null for none. A sign-in is
 * recorded when it succeeds or is refused; any other path only when it succeeds.
 */
export const authAuditEntry = async (
  path: string,
  request: Request,
  response: Response,
): Promise<AuditEntry | null> => {
  const signIn = (target: string): AuditEntry | null =>
    // A rate-limited or failing server says nothing about the credentials.
    response.status === 429 || response.status >= 500
      ? null
      : { action: "sign-in", outcome: response.ok ? "success" : "failure", target };
  switch (path) {
    case "/sign-in/email":
    case "/sign-in/username": {
      if (!response.ok) return signIn("password");
      // A password sign-in with two-step verification on is complete only after the second step.
      const answer: unknown = await response
        .clone()
        .json()
        .catch(() => null);
      const pending =
        typeof answer === "object" &&
        answer !== null &&
        Reflect.get(answer, "twoFactorRedirect") === true;
      return pending ? null : signIn("password");
    }
    case "/two-factor/verify-totp":
      if (isSecondStep(request)) return signIn("authenticator");
      return response.ok ? { action: "two-factor", target: "enabled" } : null;
    case "/two-factor/verify-backup-code":
      return isSecondStep(request) ? signIn("backup code") : null;
    case "/passkey/verify-authentication":
      return signIn("passkey");
    default:
      return response.ok && Object.hasOwn(AUTH_CHANGES, path) ? (AUTH_CHANGES[path] ?? null) : null;
  }
};

export const createApp = ({
  adapter,
  instance,
  webdavHandler,
  allowHttp = false,
  publicOrigin,
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

  /** The client's address, for the audit trail. */
  const addressOf = (request: Request) => built?.instance.clientAddress?.(request) ?? null;

  /** Records an event of the audit trail, with the client's address. */
  const audit = (request: Request, entry: AuditEntry) =>
    recordAudit({ address: addressOf(request), ...entry });

  /**
   * Serves a route with its contract (packages/schema): the program's answer is encoded through
   * the route's response schema and sent with its status.
   */
  const api =
    (
      name: RouteName,
      program: (request: Request) => Effect.Effect<unknown, { _tag: ErrorTag }, Services>,
    ) =>
    async ({ request }: { request: Request }) => {
      const current = get(request);
      if (current === undefined) return new Response(null, { status: 501 });
      if (current === null) return NOT_CONFIGURED();
      const contract = ROUTES[name];
      return await current.run(Effect.flatMap(program(request), encodeWith(contract.response)), {
        errors,
        successStatus: contract.status,
        // A defect's message can hold the values a query was bound to, so only its class, code
        // and stack frames go to the log.
        onDefect: (cause) => {
          const error = Cause.squash(cause);
          console.error("Request failed:", redactedError(error), `\n${redactedStack(error)}`);
        },
      });
    };
  const authed = <A>(
    name: RouteName,
    program: (
      user: { id: string },
      request: Request,
    ) => Effect.Effect<A, { _tag: ErrorTag }, Services>,
  ) =>
    api(name, (request) =>
      Effect.flatMap(requireUser(request.headers), (user) => program(user, request)),
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
      // A refused key is counted, never kept: only the start Davloom shows of every key.
      const refused = () =>
        current.instance.refusedCredentials?.refused({
          at: now,
          address: addressOf(request),
          keyStart: keyStartOf(basic.password),
        });
      const cached = credentials.get(basic.password);
      if (cached && cached.until > now) {
        if (cached.credential === null) refused();
        return cached.credential;
      }
      const exit = await Effect.runPromiseExit(
        Effect.provide(verifyApiKey(basic.password, now), current.instance.layer),
      );
      const credential = exit._tag === "Success" ? exit.value : null;
      if (credentials.size > 1000) credentials.clear();
      credentials.set(basic.password, { credential, until: now + CREDENTIAL_TTL_MS });
      if (credential === null) refused();
      return credential;
    }
    if (request.headers.get(DASHBOARD_HEADER) === "1") {
      const effect = davEffect(
        request.method,
        request.headers.get("overwrite"),
        request.headers.get("if-none-match"),
      );
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
    const response = await current.instance.authHandler(request);
    const entry = await authAuditEntry(path, request, response);
    if (entry !== null) {
      await Effect.runPromise(Effect.provide(audit(request, entry), current.instance.layer));
    }
    return response;
  };

  // --- Operations for the Overview ----------------------------------------------------------
  /** Serves a WebDAV request and counts it, at the cost of a counter bump in memory. */
  const countedWebdav = async (context: { request: Request }) => {
    const response = await webdav(context);
    const recorder = built?.instance.operations;
    if (recorder && !webdavHandler) {
      const { request } = context;
      const path = davPathOf(request.url);
      const destination = request.headers.get("destination");
      if (path !== null) {
        recorder.record({
          at: Date.now(),
          method: request.method.toUpperCase(),
          path,
          destination: destination === null ? null : davPathOf(destination),
          status: response.status,
        });
      }
    }
    return response;
  };

  return (
    new Elysia(adapter ? { adapter } : {})
      .onRequest(({ request }) => {
        if (allowHttp || !isInsecure(request)) return crossSiteRefusal(request, publicOrigin);
        const pathname = URL.canParse(request.url) ? new URL(request.url).pathname : "/api";
        // The health check carries no credential, and load balancers often probe it over HTTP.
        if (pathname === "/api/health" || pathname === "/api/health/") return undefined;
        return /^\/(api|dav)(\/|$)/.test(pathname)
          ? HTTPS_ONLY()
          : crossSiteRefusal(request, publicOrigin);
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
      .get("/api/health", () => ({ status: "ok" as const }))
      .all("/api/auth/*", authRoute, { parse: "none" })
      // --- Registration and step-up verification -------------------------------------------
      .get(
        "/api/registration",
        api("GET /api/registration", () => registrationStatus),
      )
      .post(
        "/api/registration",
        api("POST /api/registration", (request) =>
          Effect.flatMap(bodyOf("POST /api/registration", request), (body) =>
            registerOwner({
              username: body.username ?? "",
              name: body.name ?? "",
              email: body.email ?? "",
              password: body.password ?? "",
              setupToken: body.setupToken ?? "",
            }).pipe(
              Effect.tap(() =>
                Effect.andThen(
                  Effect.sync(invalidate),
                  audit(request, { action: "registration", target: body.username?.trim() }),
                ),
              ),
              // Once the owner exists, a refused registration is anyone's request and costs no write:
              // the audit trail is not a way to spend the instance's daily write quota.
              Effect.tapError((error) =>
                error._tag === "SetupTokenInvalid"
                  ? audit(request, { action: "registration", outcome: "failure" })
                  : Effect.void,
              ),
            ),
          ),
        ),
        { parse: "none" },
      )
      .post(
        "/api/registration/import",
        api("POST /api/registration/import", (request) =>
          Effect.flatMap(bodyOf("POST /api/registration/import", request), (body) =>
            importInstance({
              key: body.key ?? "",
              file: body.file,
              setupToken: body.setupToken ?? "",
            }).pipe(
              Effect.tap(() =>
                Effect.andThen(Effect.sync(invalidate), audit(request, { action: "import" })),
              ),
              Effect.tapError((error) =>
                error._tag === "SetupTokenInvalid" || error._tag === "ArchiveInvalid"
                  ? audit(request, { action: "import", outcome: "failure" })
                  : Effect.void,
              ),
            ),
          ),
        ),
        { parse: "none" },
      )
      .post(
        "/api/verify",
        api("POST /api/verify", (request) =>
          Effect.flatMap(bodyOf("POST /api/verify", request), (body) =>
            reverify(request.headers, {
              password: body.password ?? "",
              code: body.code ?? "",
            }).pipe(
              Effect.tap(() => audit(request, { action: "step-up" })),
              Effect.tapError((error) =>
                error._tag === "VerificationLocked"
                  ? audit(request, { action: "step-up", outcome: "locked" })
                  : error._tag === "WrongPassword" || error._tag === "WrongCode"
                    ? audit(request, { action: "step-up", outcome: "failure" })
                    : Effect.void,
              ),
            ),
          ),
        ),
        { parse: "none" },
      )
      .post(
        "/api/export",
        authed("POST /api/export", (_, request) =>
          Effect.map(exportInstance, ({ key, file }) => ({ key: Redacted.value(key), file })).pipe(
            Effect.tap(() => audit(request, { action: "export" })),
          ),
        ),
      )
      .get(
        "/api/me",
        authed("GET /api/me", (user) => Effect.succeed(user)),
      )
      .get(
        "/api/overview",
        authed("GET /api/overview", () =>
          Effect.all({ usage: instanceUsage, mounts: listMounts, backends: listBackends }),
        ),
      )
      .get(
        "/api/audit",
        authed("GET /api/audit", (_, request) =>
          Effect.flatMap(decodeQuery(ROUTES["GET /api/audit"].query, request.url), auditPage),
        ),
      )
      .get(
        "/api/openapi.json",
        authed("GET /api/openapi.json", () =>
          Effect.sync(() => (openApi ??= openApiDocument(buildInfo().version))),
        ),
      )
      .get(
        "/api/keys",
        authed("GET /api/keys", () => listKeys),
      )
      .post(
        "/api/keys",
        authed("POST /api/keys", (user, request) =>
          Effect.flatMap(bodyOf("POST /api/keys", request), (body) =>
            Effect.tap(
              createKey(user.id, {
                name: body.name ?? "",
                access: body.access ?? "",
                expiresInDays: body.expiresInDays ?? null,
                paths: body.paths,
              }),
              () => audit(request, { action: "key.create", target: body.name?.trim() }),
            ),
          ),
        ),
        { parse: "none" },
      )
      .patch(
        "/api/keys/:id",
        ({ params, request }) =>
          authed("PATCH /api/keys/:id", (_, req) =>
            Effect.flatMap(bodyOf("PATCH /api/keys/:id", req), (body) =>
              Effect.tap(renameKey(params.id, { name: body.name ?? "" }), (renamed) =>
                audit(req, { action: "key.rename", target: renamed.name }),
              ),
            ),
          )({ request }),
        { parse: "none" },
      )
      .delete("/api/keys/:id", ({ params, request }) =>
        authed("DELETE /api/keys/:id", (_, req) =>
          Effect.tap(revokeKey(params.id), () =>
            Effect.andThen(
              Effect.sync(() => credentials.clear()),
              audit(req, { action: "key.revoke", target: params.id }),
            ),
          ),
        )({ request }),
      )
      .get(
        "/api/backends",
        authed("GET /api/backends", () => listBackends),
      )
      .post(
        "/api/backends",
        authed("POST /api/backends", (_, request) =>
          Effect.flatMap(bodyOf("POST /api/backends", request), (body) =>
            Effect.tap(
              createBackend({
                name: body.name ?? "",
                kind: body.kind || "durable-object",
                config: body.config,
                secretKey: body.secretKey ?? "",
              }),
              () => audit(request, { action: "backend.create", target: body.name?.trim() }),
            ),
          ),
        ),
        { parse: "none" },
      )
      .get(
        "/api/mounts",
        authed("GET /api/mounts", () => listMounts),
      )
      .post(
        "/api/mounts",
        authed("POST /api/mounts", (_, request) =>
          Effect.flatMap(bodyOf("POST /api/mounts", request), (body) =>
            Effect.tap(
              createMount({
                name: body.name ?? "",
                backendId: body.backendId ?? "",
                root: body.root ?? "",
              }),
              () =>
                Effect.andThen(
                  Effect.sync(invalidate),
                  audit(request, { action: "mount.create", target: body.name }),
                ),
            ),
          ),
        ),
        { parse: "none" },
      )
      .patch(
        "/api/mounts/:id",
        ({ params, request }) =>
          authed("PATCH /api/mounts/:id", (_, req) =>
            Effect.flatMap(bodyOf("PATCH /api/mounts/:id", req), (body) =>
              Effect.tap(
                // A body with a backend points the Mount there; otherwise it renames it.
                body.backendId === undefined
                  ? renameMount(params.id, body.name ?? "")
                  : retargetMount(params.id, { backendId: body.backendId, root: body.root ?? "" }),
                () =>
                  Effect.andThen(
                    Effect.sync(invalidate),
                    audit(req, {
                      action: "mount.edit",
                      target: body.backendId === undefined ? body.name : params.id,
                    }),
                  ),
              ),
            ),
          )({ request }),
        { parse: "none" },
      )
      .delete("/api/mounts/:id", ({ params, request }) =>
        authed("DELETE /api/mounts/:id", (_, req) =>
          Effect.tap(removeMount(params.id), () =>
            Effect.andThen(
              Effect.sync(invalidate),
              audit(req, { action: "mount.remove", target: params.id }),
            ),
          ),
        )({ request }),
      )
      // --- Overview operations, backend changes and checks, settings, about ------------------
      .get(
        "/api/operations",
        authed("GET /api/operations", () => operationSummary(Date.now())),
      )
      .post(
        "/api/backends/check",
        authed("POST /api/backends/check", () => checkBackends()),
      )
      .post("/api/backends/:id/verify", ({ params, request }) =>
        authed("POST /api/backends/:id/verify", () => verifyBackend(params.id))({ request }),
      )
      .patch(
        "/api/backends/:id",
        ({ params, request }) =>
          authed("PATCH /api/backends/:id", (_, req) =>
            Effect.flatMap(bodyOf("PATCH /api/backends/:id", req), (body) =>
              Effect.tap(
                updateBackend(params.id, {
                  name: body.name ?? "",
                  config: body.config,
                  secretKey: body.secretKey ?? "",
                }),
                () =>
                  Effect.andThen(
                    Effect.sync(invalidate),
                    audit(req, { action: "backend.edit", target: body.name?.trim() }),
                  ),
              ),
            ),
          )({ request }),
        { parse: "none" },
      )
      .delete("/api/backends/:id", ({ params, request }) =>
        authed("DELETE /api/backends/:id", (_, req) =>
          Effect.tap(removeBackend(params.id), () =>
            Effect.andThen(
              Effect.sync(invalidate),
              audit(req, { action: "backend.remove", target: params.id }),
            ),
          ),
        )({ request }),
      )
      .get(
        "/api/settings/storage",
        authed("GET /api/settings/storage", () => storageSettings),
      )
      .put(
        "/api/settings/storage",
        authed("PUT /api/settings/storage", (_, request) =>
          Effect.flatMap(bodyOf("PUT /api/settings/storage", request), (body) =>
            Effect.tap(saveStorageSettings({ defaultBackendId: body.defaultBackendId }), () =>
              audit(request, { action: "settings", target: "default backend" }),
            ),
          ),
        ),
        { parse: "none" },
      )
      .get(
        "/api/instance",
        authed("GET /api/instance", (_, request) =>
          Effect.map(InstanceConfigService, (config) => ({
            ...buildInfo(),
            ...(built?.instance.about?.(request) ?? {
              runtime: "Unknown",
              deployment: "Unknown",
              region: null,
              database: "Unknown",
            }),
            /** The storage kinds a new backend may take here. */
            storageKinds: config.storageKinds,
          })),
        ),
      )
      // Elysia must leave the body unread and the path undecoded: the handler gets the raw request.
      .all("/dav", countedWebdav, { parse: "none" })
      .all("/dav/*", countedWebdav, { parse: "none" })
  );
};
