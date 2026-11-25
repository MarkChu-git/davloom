import { Schema } from "effect";

// The bodies of Davloom's management API (apps/api/src/app.ts): what each route takes and what it
// answers. The API decodes every request body with these schemas and encodes every answer through
// them, the OpenAPI document (openapi.ts) is generated from them, and a typed client can import them.
//
// A request field that the services check themselves, such as a name's length or an access level,
// is only typed here: the services answer `invalid_input` for a value they refuse, so the API's
// answers stay the ones the Dashboard knows. A field of the wrong JSON type is refused here.

/** A JSON number: finite, as JSON has no other. */
const Count = Schema.Finite;
/** An instant as ISO 8601, such as 2026-11-24T08:00:00.000Z. */
const Instant = Schema.String.annotate({ format: "date-time" });

const text = (description: string) => Schema.optionalKey(Schema.String.annotate({ description }));

// --- Errors ----------------------------------------------------------------------------------

export const ApiIssue = Schema.Struct({
  /** Where in the body, as the keys and indexes leading to the value. */
  path: Schema.Array(Schema.Union([Schema.String, Count])),
  message: Schema.String,
}).annotate({ identifier: "ApiIssue" });

export const ApiErrorBody = Schema.Struct({
  error: Schema.Struct({
    code: Schema.String.annotate({
      description: "Machine-readable, such as invalid_input, invalid_json or invalid_body.",
    }),
    message: Schema.optionalKey(Schema.String),
    reason: Schema.optionalKey(
      Schema.Literals([
        "too_short",
        "too_long",
        "compromised",
        "taken",
        "invalid_characters",
        "invalid",
      ]).annotate({
        description:
          "Why username_refused, password_refused or email_refused refused the field, machine-readable: too_short, too_long, compromised (found in known breaches), taken, invalid_characters or invalid. `message` says the same in English.",
      }),
    ),
    issues: Schema.optionalKey(Schema.Array(ApiIssue)),
  }),
}).annotate({ identifier: "ApiError" });

// --- Registration and verification -----------------------------------------------------------

export const Health = Schema.Struct({ status: Schema.Literal("ok") }).annotate({
  identifier: "Health",
});

export const RegistrationStatus = Schema.Struct({
  open: Schema.Boolean,
  tokenRequired: Schema.Boolean,
  passkeys: Schema.Boolean,
}).annotate({ identifier: "RegistrationStatus" });

export const RegistrationRequest = Schema.Struct({
  username: text("The username the owner signs in with."),
  name: text("The display name; the username when empty."),
  email: text("An email to sign in with, or empty."),
  password: text("The owner's password."),
  setupToken: text("DAVLOOM_SETUP_TOKEN, when the deployment sets one."),
}).annotate({ identifier: "RegistrationRequest" });

export const Registered = Schema.Struct({ userId: Schema.String }).annotate({
  identifier: "Registered",
});

export const ImportRequest = Schema.Struct({
  key: text("The export key the export showed once."),
  file: Schema.optionalKey(Schema.Unknown.annotate({ description: "The export file." })),
  setupToken: text("DAVLOOM_SETUP_TOKEN, when the deployment sets one."),
}).annotate({ identifier: "ImportRequest" });

/** How many records of each table an import wrote. */
export const Imported = Schema.Record(Schema.String, Count).annotate({ identifier: "Imported" });

export const VerifyRequest = Schema.Struct({
  password: text("The owner's password."),
  code: text("The authenticator's code, when two-step verification is on."),
}).annotate({ identifier: "VerifyRequest" });

export const Verified = Schema.Struct({ verified: Schema.Literal(true) }).annotate({
  identifier: "Verified",
});

export const ArchiveFile = Schema.Struct({
  format: Schema.Literal("davloom-export"),
  version: Schema.Literal(1),
  createdAt: Instant,
  iv: Schema.String,
  data: Schema.String,
}).annotate({ identifier: "ArchiveFile" });

export const Exported = Schema.Struct({
  key: Schema.String.annotate({ description: "Opens the file; shown only in this answer." }),
  file: ArchiveFile,
}).annotate({ identifier: "Exported" });

export const Me = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  username: Schema.NullOr(Schema.String),
  email: Schema.NullOr(Schema.String),
  twoFactorEnabled: Schema.Boolean,
  verifiedAt: Count.annotate({ description: "When the session last proved presence, in ms." }),
}).annotate({ identifier: "Me" });

// --- Storage, Mounts and API Keys ------------------------------------------------------------

export const Usage = Schema.Struct({
  files: Count,
  collections: Count,
  bytes: Count,
  measuredAt: Schema.optionalKey(Count),
}).annotate({ identifier: "Usage" });

export const BackendStatus = Schema.Union([
  Schema.Struct({ state: Schema.Literal("answered"), ms: Count }),
  Schema.Struct({ state: Schema.Literal("failed"), failure: Schema.String, ms: Count }),
  Schema.Struct({ state: Schema.Literal("not-opened") }),
]).annotate({ identifier: "BackendStatus" });

export const Backend = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  kind: Schema.String,
  createdAt: Instant,
  available: Schema.Boolean,
  usage: Schema.NullOr(Usage),
  status: BackendStatus,
  capacity: Schema.NullOr(Count),
  config: Schema.Record(Schema.String, Schema.Union([Schema.String, Schema.Boolean])),
  hasSecretKey: Schema.Boolean,
}).annotate({ identifier: "Backend" });

export const Mount = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  backendId: Schema.String,
  backendKind: Schema.String,
  root: Schema.String,
  createdAt: Instant,
}).annotate({ identifier: "Mount" });

export const Overview = Schema.Struct({
  usage: Usage,
  mounts: Schema.Array(Mount),
  backends: Schema.Array(Backend),
}).annotate({ identifier: "Overview" });

export const ApiKey = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  start: Schema.NullOr(Schema.String),
  access: Schema.Literals(["read-only", "read-write"]),
  paths: Schema.NullOr(Schema.Array(Schema.String)),
  enabled: Schema.Boolean,
  expiresAt: Schema.NullOr(Instant),
  createdAt: Instant,
  lastUsedAt: Schema.NullOr(Instant),
}).annotate({ identifier: "ApiKey" });

export const CreateKeyRequest = Schema.Struct({
  name: text("Up to 64 characters."),
  access: text("read-only or read-write."),
  expiresInDays: Schema.optionalKey(
    Schema.NullOr(Count).annotate({ description: "1 to 3650 days; null never expires." }),
  ),
  paths: Schema.optionalKey(
    Schema.NullOr(Schema.Array(Schema.String)).annotate({
      description: "Roots such as /files/photos; null or absent for every Mount.",
    }),
  ),
}).annotate({ identifier: "CreateKeyRequest" });

export const CreatedKey = Schema.Struct({
  id: Schema.String,
  key: Schema.String.annotate({ description: "The secret, shown only in this answer." }),
}).annotate({ identifier: "CreatedKey" });

export const RenameRequest = Schema.Struct({ name: text("Up to 64 characters.") }).annotate({
  identifier: "RenameRequest",
});

export const RenamedKey = Schema.Struct({ id: Schema.String, name: Schema.String }).annotate({
  identifier: "RenamedKey",
});

export const Id = Schema.Struct({ id: Schema.String }).annotate({ identifier: "Id" });

export const CreateBackendRequest = Schema.Struct({
  name: text("Up to 64 characters."),
  kind: text("A storage kind of the instance; durable-object when empty."),
  config: Schema.optionalKey(
    Schema.Unknown.annotate({ description: "The kind's settings, such as an S3 endpoint." }),
  ),
  secretKey: text("An S3-compatible store's secret access key."),
}).annotate({ identifier: "CreateBackendRequest" });

export const UpdateBackendRequest = Schema.Struct({
  name: text("Up to 64 characters."),
  config: Schema.optionalKey(Schema.Unknown.annotate({ description: "The kind's settings." })),
  secretKey: text("A new secret access key; empty keeps the stored one."),
}).annotate({ identifier: "UpdateBackendRequest" });

export const RemovedBackend = Schema.Struct({
  id: Schema.String,
  filesKept: Schema.Boolean,
}).annotate({ identifier: "RemovedBackend" });

export const BackendCheck = Schema.Struct({
  id: Schema.String,
  name: Schema.String,
  available: Schema.Boolean,
  latencyMs: Schema.NullOr(Count),
  reason: Schema.NullOr(Schema.String),
  checkedAt: Instant,
}).annotate({ identifier: "BackendCheck" });

export const CreateMountRequest = Schema.Struct({
  name: text("A path segment of up to 64 characters."),
  backendId: text("The backend the Mount publishes."),
  root: text("A collection inside the backend; empty for its root."),
}).annotate({ identifier: "CreateMountRequest" });

export const UpdateMountRequest = Schema.Struct({
  name: text("A new name, when backendId is absent."),
  backendId: text("Points the Mount at this backend; the name is then ignored."),
  root: text("The collection inside the new backend."),
}).annotate({ identifier: "UpdateMountRequest" });

export const StorageSettings = Schema.Struct({
  defaultBackendId: Schema.NullOr(Schema.String),
}).annotate({ identifier: "StorageSettings" });

export const StorageSettingsRequest = Schema.Struct({
  defaultBackendId: Schema.optionalKey(Schema.NullOr(Schema.String)),
}).annotate({ identifier: "StorageSettingsRequest" });

// --- Operations, instance, audit -------------------------------------------------------------

export const Operations = Schema.Struct({
  hours: Schema.Array(Schema.Struct({ start: Instant, operations: Count, failed: Count })),
  errors: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      at: Instant,
      method: Schema.String,
      path: Schema.String,
      destination: Schema.NullOr(Schema.String),
      status: Count,
    }),
  ),
}).annotate({ identifier: "Operations" });

export const InstanceInfo = Schema.Struct({
  version: Schema.String,
  commit: Schema.NullOr(Schema.String),
  runtime: Schema.String,
  deployment: Schema.String,
  region: Schema.NullOr(Schema.String),
  database: Schema.String,
  storageKinds: Schema.Array(Schema.String),
}).annotate({ identifier: "InstanceInfo" });

/** What the audit trail records (PRD §7 `audit_events`). */
export const AUDIT_ACTIONS = [
  "sign-in",
  "sign-out",
  "registration",
  "import",
  "export",
  "step-up",
  "password",
  "email",
  "two-factor",
  "passkey",
  "sessions",
  "key.create",
  "key.rename",
  "key.revoke",
  "backend.create",
  "backend.edit",
  "backend.remove",
  "mount.create",
  "mount.edit",
  "mount.remove",
  "settings",
  "webdav.auth",
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export const AUDIT_OUTCOMES = ["success", "failure", "locked"] as const;
export type AuditOutcome = (typeof AUDIT_OUTCOMES)[number];

export const AuditEvent = Schema.Struct({
  id: Schema.String,
  at: Instant,
  action: Schema.Literals(AUDIT_ACTIONS),
  outcome: Schema.Literals(AUDIT_OUTCOMES),
  address: Schema.NullOr(Schema.String).annotate({ description: "The client's address." }),
  target: Schema.NullOr(Schema.String).annotate({
    description: "What the action named, such as a key's or a Mount's name; never a secret.",
  }),
  count: Count.annotate({ description: "How many times it happened within the minute." }),
}).annotate({ identifier: "AuditEvent" });

export const AuditPage = Schema.Struct({
  events: Schema.Array(AuditEvent),
  next: Schema.NullOr(Schema.String).annotate({
    description: "Pass as `before` for the next page; null on the last.",
  }),
}).annotate({ identifier: "AuditPage" });

export const AuditQuery = Schema.Struct({
  before: Schema.optionalKey(
    Schema.String.annotate({ description: "The `next` of the page before." }),
  ),
  limit: Schema.optionalKey(
    Schema.String.check(Schema.isPattern(/^[1-9][0-9]{0,2}$/)).annotate({
      description: "1 to 100 events; 50 when absent.",
    }),
  ),
}).annotate({ identifier: "AuditQuery" });

export const ApiKeys = Schema.Array(ApiKey);
export const Backends = Schema.Array(Backend);
export const Mounts = Schema.Array(Mount);
export const BackendChecks = Schema.Array(BackendCheck);

/** The OpenAPI document, which is JSON. */
export const OpenApiDocument = Schema.Record(Schema.String, Schema.Unknown).annotate({
  identifier: "OpenApiDocument",
});
