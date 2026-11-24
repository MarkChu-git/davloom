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
  "0004_settings_and_operations": [
    {
      table: "settings",
      row: { key: "storage", value: '{"defaultBackendId":"backend-1"}', updated_at: LATER },
    },
    {
      table: "operation_hours",
      row: { hour: 498_888, operations: 42, failed: 3 },
    },
    {
      table: "operation_errors",
      row: {
        id: "error-1",
        at: LATER,
        method: "MOVE",
        path: "/files/Drafts/report 2026 – final.txt",
        destination: "/files/Archive/report.txt",
        status: 412,
      },
    },
  ],
  // The owner's username, display username and two-step flag are columns of the one user row,
  // which 0000 writes; a second user would meet the trigger that keeps Davloom to one owner.
  "0005_accounts": [
    {
      table: "two_factor",
      row: {
        id: "two-factor-1",
        secret: "encrypted-totp-secret",
        backup_codes: "encrypted-backup-codes",
        user_id: "user-1",
        verified: 1,
        failed_verification_count: 0,
        locked_until: null,
      },
    },
    {
      table: "passkey",
      row: {
        id: "passkey-1",
        name: "Laptop – Touch ID",
        public_key: "cHVibGljLWtleQ",
        user_id: "user-1",
        credential_id: "Y3JlZGVudGlhbC0x",
        counter: 7,
        device_type: "multiDevice",
        backed_up: 1,
        transports: "internal,hybrid",
        created_at: CREATED,
        aaguid: "fbfc3007-154e-4ecc-8c0b-6e020557d7bd",
      },
    },
    {
      table: "session",
      row: {
        id: "session-2",
        expires_at: LATER,
        token: "session-token-2",
        created_at: CREATED,
        updated_at: UPDATED,
        ip_address: "198.51.100.4",
        user_agent: "Mozilla/5.0 (iPhone)",
        user_id: "user-1",
        verified_at: UPDATED,
      },
    },
  ],
  "0006_rate_limit": [
    {
      table: "rate_limit",
      row: { id: "rate-1", key: "203.0.113.7|/sign-in/username", count: 2, last_request: LATER },
    },
    {
      table: "rate_limit",
      row: { id: "rate-2", key: "davloom:presence:user-1", count: 5, last_request: LATER },
    },
  ],
  "0007_verification_attempts": [
    {
      table: "verification_attempts",
      row: { user_id: "user-1", count: 3, last_attempt: LATER },
    },
  ],
  "0008_audit_events": [
    {
      table: "audit_events",
      row: {
        id: "audit-1",
        at: UPDATED,
        action: "key.create",
        outcome: "success",
        address: "2001:db8::7",
        target: "Laptop – 管理者 😀",
        count: 1,
      },
    },
    {
      table: "audit_events",
      row: {
        id: `webdav.auth:${LATER}:203.0.113.7:dav_abcdef`,
        at: LATER,
        action: "webdav.auth",
        outcome: "failure",
        address: "203.0.113.7",
        target: "dav_abcdef",
        count: 42,
      },
    },
    {
      table: "audit_events",
      row: {
        id: "audit-3",
        at: CREATED,
        action: "sign-out",
        outcome: "success",
        address: null,
        target: null,
        count: 1,
      },
    },
  ],
};
