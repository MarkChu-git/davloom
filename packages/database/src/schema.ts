import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

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
