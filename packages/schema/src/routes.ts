import type { Schema } from "effect";
import * as Api from "./api";

// Every route of the management API under /api, outside Better Auth's own /api/auth/*, with the
// schemas of its body, its query and its answer. The API serves each route with its entry here,
// and the OpenAPI document lists exactly these. apps/api/src/app.test.ts checks that every /api
// route of the app has one.

type AnySchema = Schema.Codec<any, any>;

export interface RouteContract {
  readonly summary: string;
  /** The JSON body it takes, when it takes one. */
  readonly body?: AnySchema;
  /** Its query parameters, all strings. */
  readonly query?: AnySchema;
  /** Its answer on success. */
  readonly response: AnySchema;
  /** The status of that answer. */
  readonly status: 200 | 201;
  /** Whether it answers a visitor without a session. */
  readonly public?: boolean;
}

/** A route that answers 200, keeping its answer's schema in the type for typed clients. */
const read = <Response extends AnySchema>(summary: string, response: Response) =>
  ({ summary, response, status: 200 }) as const satisfies RouteContract;

export const ROUTES = {
  "GET /api/health": { ...read("Whether the server answers", Api.Health), public: true },
  "GET /api/registration": {
    ...read("Whether the owner may still register", Api.RegistrationStatus),
    public: true,
  },
  "POST /api/registration": {
    summary: "Registers the owner, then closes registration",
    body: Api.RegistrationRequest,
    response: Api.Registered,
    status: 201,
    public: true,
  },
  "POST /api/registration/import": {
    summary: "Imports an export in place of registering the owner",
    body: Api.ImportRequest,
    response: Api.Imported,
    status: 201,
    public: true,
  },
  "POST /api/verify": {
    summary: "Proves presence again for step-up actions",
    body: Api.VerifyRequest,
    response: Api.Verified,
    status: 200,
    public: true,
  },
  "POST /api/export": read("Exports the instance, encrypted under a new key", Api.Exported),
  "GET /api/me": read("The signed-in owner", Api.Me),
  "GET /api/overview": read("Usage, Mounts and backends", Api.Overview),
  "GET /api/operations": read("WebDAV operations of the last 24 hours", Api.Operations),
  "GET /api/instance": read("Where this instance runs", Api.InstanceInfo),
  "GET /api/audit": {
    ...read("The audit trail, newest first", Api.AuditPage),
    query: Api.AuditQuery,
  },
  "GET /api/openapi.json": read("This document", Api.OpenApiDocument),
  "GET /api/keys": read("The API Keys", Api.ApiKeys),
  "POST /api/keys": {
    summary: "Creates an API Key",
    body: Api.CreateKeyRequest,
    response: Api.CreatedKey,
    status: 201,
  },
  "PATCH /api/keys/:id": {
    summary: "Renames an API Key",
    body: Api.RenameRequest,
    response: Api.RenamedKey,
    status: 200,
  },
  "DELETE /api/keys/:id": read("Revokes an API Key", Api.Id),
  "GET /api/backends": read("The storage backends", Api.Backends),
  "POST /api/backends": {
    summary: "Adds a storage backend",
    body: Api.CreateBackendRequest,
    response: Api.Id,
    status: 201,
  },
  "PATCH /api/backends/:id": {
    summary: "Renames a backend or changes its settings",
    body: Api.UpdateBackendRequest,
    response: Api.Id,
    status: 200,
  },
  "DELETE /api/backends/:id": read("Removes a backend no Mount uses", Api.RemovedBackend),
  "POST /api/backends/check": read("Asks every backend whether it answers", Api.BackendChecks),
  "POST /api/backends/:id/verify": read("Asks one backend whether it answers", Api.BackendCheck),
  "GET /api/settings/storage": read("The storage settings", Api.StorageSettings),
  "PUT /api/settings/storage": {
    summary: "Chooses the default backend for new Mounts",
    body: Api.StorageSettingsRequest,
    response: Api.StorageSettings,
    status: 200,
  },
  "GET /api/mounts": read("The Mounts", Api.Mounts),
  "POST /api/mounts": {
    summary: "Creates a Mount",
    body: Api.CreateMountRequest,
    response: Api.Id,
    status: 201,
  },
  "PATCH /api/mounts/:id": {
    summary: "Renames a Mount, or points it at another backend",
    body: Api.UpdateMountRequest,
    response: Api.Id,
    status: 200,
  },
  "DELETE /api/mounts/:id": read("Removes a Mount", Api.Id),
} as const satisfies Record<string, RouteContract>;

export type RouteName = keyof typeof ROUTES;

/** The contract of a route, by `METHOD pattern`; undefined for one the table does not name. */
export const routeContract = (method: string, pattern: string): RouteContract | undefined =>
  Object.hasOwn(ROUTES, `${method.toUpperCase()} ${pattern}`)
    ? (ROUTES as Record<string, RouteContract>)[`${method.toUpperCase()} ${pattern}`]
    : undefined;
