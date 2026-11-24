// Rows that a database could hold under each migration of packages/database/drizzle, keyed by the
// migration that creates their table. The upgrade suite writes the rows of every migration a
// release had applied, upgrades the database, and reads them back. A migration without an entry
// here fails the suite, so each new migration brings rows for the tables it adds.

export type Value = string | number | null;
export type Row = Readonly<Record<string, Value>>;

export interface Sample {
  readonly table: string;
  readonly row: Row;
}

const CREATED = 1_793_899_227_000;
const UPDATED = 1_795_469_544_000;
const LATER = 1_826_000_000_000;

export const SAMPLES: Readonly<Record<string, readonly Sample[]>> = {
  "0000_initial": [
    {
      table: "user",
      row: {
        id: "user-1",
        name: "Ädmin 管理者 😀",
        email: "admin@example.com",
        email_verified: 1,
        image: null,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    },
    {
      table: "account",
      row: {
        id: "account-1",
        account_id: "user-1",
        provider_id: "credential",
        user_id: "user-1",
        password: "scrypt:16384:8:1:c2FsdA==:aGFzaA==",
        access_token: null,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    },
    {
      table: "session",
      row: {
        id: "session-1",
        expires_at: LATER,
        token: "session-token-1",
        created_at: CREATED,
        updated_at: UPDATED,
        ip_address: "203.0.113.7",
        user_agent: "Mozilla/5.0 (Macintosh)",
        user_id: "user-1",
      },
    },
    {
      table: "verification",
      row: {
        id: "verification-1",
        identifier: "reset:admin@example.com",
        value: "one-time value",
        expires_at: LATER,
        created_at: CREATED,
        updated_at: null,
      },
    },
    {
      table: "apikey",
      row: {
        id: "key-1",
        config_id: "default",
        name: "Work laptop",
        start: "dav_ab",
        reference_id: "user-1",
        prefix: "dav_",
        key: "hash-of-the-work-laptop-key",
        enabled: 1,
        rate_limit_enabled: 0,
        request_count: 42,
        expires_at: LATER,
        created_at: CREATED,
        updated_at: UPDATED,
        permissions: '{"files":["read","write"]}',
        metadata: '{"paths":["/files/Photos"]}',
      },
    },
  ],
  "0001_storage_backends": [
    {
      table: "storage_backends",
      row: {
        id: "backend-1",
        name: "Default",
        kind: "durable-object",
        config: "{}",
        secret_key: null,
        created_at: CREATED,
        updated_at: UPDATED,
      },
    },
    {
      table: "storage_backends",
      row: {
        id: "backend-2",
        name: "Archive on S3",
        kind: "s3",
        config: '{"endpoint":"https://s3.example.com","bucket":"archive","region":"auto"}',
        secret_key: "the-encrypted-secret-key",
        created_at: CREATED,
        updated_at: UPDATED,
      },
    },
  ],
  "0002_mounts_and_locks": [
    {
      table: "mounts",
      row: {
        id: "mount-1",
        name: "files",
        backend_id: "backend-1",
        root: "",
        created_at: CREATED,
        updated_at: UPDATED,
      },
    },
    {
      table: "mounts",
      row: {
        id: "mount-2",
        name: "archive",
        backend_id: "backend-2",
        root: "davloom/archive",
        created_at: CREATED,
        updated_at: UPDATED,
      },
    },
    {
      table: "dav_locks",
      row: {
        token: "opaquelocktoken:sample-lock-1",
        root: "/files/Drafts/",
        depth: "infinity",
        scope: "exclusive",
        owner: "<D:href>mailto:admin@example.com</D:href>",
        timeout: 3600,
        expires_at: LATER,
      },
    },
  ],
  "0003_dav_properties": [
    {
      table: "dav_properties",
      row: {
        backend_id: "backend-1",
        path: "Drafts/report 2026 – final.txt",
        name: "{http://example.com/ns}color",
        xml: '<x:color xmlns:x="http://example.com/ns">blue</x:color>',
      },
    },
  ],
};
