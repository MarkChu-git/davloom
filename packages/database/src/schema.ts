import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

const timestamp = (name: string) => integer(name, { mode: "timestamp_ms" });
const flag = (name: string) => integer(name, { mode: "boolean" });

// Better Auth's tables, in the shape its Drizzle adapter expects.

export const user = sqliteTable("user", {
  id: text("id").primaryKey(),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  emailVerified: flag("email_verified").notNull().default(false),
  image: text("image"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
  // The username plugin: the name the owner signs in with, normalized to lower case, and as typed.
  username: text("username").unique(),
  displayUsername: text("display_username"),
  // The two-factor plugin: whether sign-in asks for a second step.
  twoFactorEnabled: flag("two_factor_enabled").default(false),
});

export const session = sqliteTable(
  "session",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at").notNull(),
    token: text("token").notNull().unique(),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    // When the session last proved presence again for a step-up action; null until it does.
    verifiedAt: timestamp("verified_at"),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_user_id_idx").on(table.userId)],
);

export const account = sqliteTable(
  "account",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at"),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at"),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
  },
  (table) => [index("account_user_id_idx").on(table.userId)],
);

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at").notNull(),
    createdAt: timestamp("created_at"),
    updatedAt: timestamp("updated_at"),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
);

// The two-factor plugin's TOTP secret and backup codes, both encrypted with the instance secret.
export const twoFactor = sqliteTable(
  "two_factor",
  {
    id: text("id").primaryKey(),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    verified: flag("verified").default(true),
    failedVerificationCount: integer("failed_verification_count").default(0),
    lockedUntil: timestamp("locked_until"),
  },
  (table) => [
    index("two_factor_secret_idx").on(table.secret),
    index("two_factor_user_id_idx").on(table.userId),
  ],
);

// The passkey plugin's WebAuthn credentials.
export const passkey = sqliteTable(
  "passkey",
  {
    id: text("id").primaryKey(),
    name: text("name"),
    publicKey: text("public_key").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    credentialID: text("credential_id").notNull(),
    counter: integer("counter").notNull(),
    deviceType: text("device_type").notNull(),
    backedUp: flag("backed_up").notNull(),
    transports: text("transports"),
    createdAt: timestamp("created_at"),
    aaguid: text("aaguid"),
  },
  (table) => [
    index("passkey_user_id_idx").on(table.userId),
    index("passkey_credential_id_idx").on(table.credentialID),
  ],
);

// Better Auth's rate limiter, in the database so that every Worker isolate and Bun process counts
// the same requests. Better Auth prunes it as it likes, so Davloom's own counts live in
// `verification_attempts` below. `last_request` is milliseconds since the epoch.
export const rateLimit = sqliteTable("rate_limit", {
  id: text("id").primaryKey(),
  key: text("key").notNull().unique(),
  count: integer("count").notNull(),
  lastRequest: integer("last_request").notNull(),
});

// Each user's failed proofs of presence: wrong passwords and authenticator codes at step-up
// verification and for a signed-in session (packages/auth/src/attempts.ts). Davloom's own
// table, so no pruning of Better Auth's rate limit can lift a lock early. `last_attempt` is
// milliseconds since the epoch of the last attempt that counted.
export const verificationAttempts = sqliteTable("verification_attempts", {
  userId: text("user_id").primaryKey(),
  count: integer("count").notNull(),
  lastAttempt: integer("last_attempt").notNull(),
});

export const apikey = sqliteTable(
  "apikey",
  {
    id: text("id").primaryKey(),
    configId: text("config_id").notNull().default("default"),
    name: text("name"),
    start: text("start"),
    referenceId: text("reference_id").notNull(),
    prefix: text("prefix"),
    /** A hash of the key. The key itself is shown once at creation and never stored. */
    key: text("key").notNull(),
    refillInterval: integer("refill_interval"),
    refillAmount: integer("refill_amount"),
    lastRefillAt: timestamp("last_refill_at"),
    enabled: flag("enabled").default(true),
    rateLimitEnabled: flag("rate_limit_enabled").default(true),
    rateLimitTimeWindow: integer("rate_limit_time_window"),
    rateLimitMax: integer("rate_limit_max"),
    requestCount: integer("request_count").default(0),
    remaining: integer("remaining"),
    lastRequest: timestamp("last_request"),
    expiresAt: timestamp("expires_at"),
    createdAt: timestamp("created_at").notNull(),
    updatedAt: timestamp("updated_at").notNull(),
    permissions: text("permissions"),
    metadata: text("metadata"),
  },
  (table) => [
    index("apikey_config_id_idx").on(table.configId),
    index("apikey_reference_id_idx").on(table.referenceId),
    index("apikey_key_idx").on(table.key),
  ],
);

// The storage backends of the instance (Decision 7 of add-phase-1-core). `config` holds the fields of
// the backend's kind without any secret, as JSON, and `secret_key` holds an S3-compatible backend's
// secret key as the credential cipher sealed it, or nothing for the other kinds. SQLite compares
// text byte by byte in UTF-8, so the unique index on `name` compares names code point by code point.
export const storageBackends = sqliteTable("storage_backends", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  kind: text("kind").notNull(),
  config: text("config", { mode: "json" }).notNull(),
  secretKey: text("secret_key"),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// A Mount publishes a path of a backend at /dav/<name>/. `root` is the path in the backend, its names
// joined by "/", or empty for the backend's root.
export const mounts = sqliteTable("mounts", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  backendId: text("backend_id")
    .notNull()
    .references(() => storageBackends.id),
  root: text("root").notNull().default(""),
  createdAt: timestamp("created_at").notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// WebDAV locks (RFC 4918 §6). `root` is the locked path of the WebDAV namespace, names joined by "/".
export const davLocks = sqliteTable(
  "dav_locks",
  {
    token: text("token").primaryKey(),
    root: text("root").notNull(),
    depth: text("depth").notNull(),
    scope: text("scope").notNull(),
    owner: text("owner").notNull(),
    timeout: integer("timeout").notNull(),
    expiresAt: integer("expires_at").notNull(),
  },
  (table) => [index("dav_locks_root_idx").on(table.root)],
);

// Dead properties (RFC 4918 §4) of backends that cannot keep them themselves, such as R2 and
// S3-compatible storage. `path` is the path in the backend, names joined by "/", or empty for its
// root; `name` is the property's name in Clark notation and `xml` its element. Removing a backend
// removes its properties through the Property Store, so the table has no foreign key.
export const davProperties = sqliteTable(
  "dav_properties",
  {
    backendId: text("backend_id").notNull(),
    path: text("path").notNull(),
    name: text("name").notNull(),
    xml: text("xml").notNull(),
  },
  (table) => [primaryKey({ columns: [table.backendId, table.path, table.name] })],
);

// Instance settings (PRD §7, `settings`) the administrator changes on the Dashboard, such as the
// default backend for new Mounts.
// `value` holds each setting as JSON.
export const settings = sqliteTable("settings", {
  key: text("key").primaryKey(),
  value: text("value", { mode: "json" }).notNull(),
  updatedAt: timestamp("updated_at").notNull(),
});

// WebDAV operations per hour (PRD §8.1). `hour` is the hour's start in milliseconds since the
// epoch. Each isolate adds its counts in one statement every few seconds, never one per request.
export const operationHours = sqliteTable("operation_hours", {
  hour: integer("hour").primaryKey(),
  operations: integer("operations").notNull(),
  failed: integer("failed").notNull(),
});

// The latest failed WebDAV operations, kept for two days. `at` is in milliseconds since the epoch;
// `path` and `destination` are paths under /dav.
export const operationErrors = sqliteTable(
  "operation_errors",
  {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    method: text("method").notNull(),
    path: text("path").notNull(),
    destination: text("destination"),
    status: integer("status").notNull(),
  },
  (table) => [index("operation_errors_at_idx").on(table.at)],
);

// The audit trail (PRD §7 `audit_events`), kept for 90 days. `at` is in milliseconds since the
// epoch. `target` names what an action acted on, such as a key's name, and never holds a secret;
// `count` is how many times a counted event, such as a refused WebDAV credential, happened in its
// minute, whose id it shares in every isolate.
export const auditEvents = sqliteTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    at: integer("at").notNull(),
    action: text("action").notNull(),
    outcome: text("outcome").notNull(),
    address: text("address"),
    target: text("target"),
    count: integer("count").notNull().default(1),
  },
  (table) => [index("audit_events_at_idx").on(table.at, table.id)],
);
