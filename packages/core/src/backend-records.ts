import { Context, Data, type Effect } from "effect";

// The backend records Port (Decisions 7 and 8 of add-phase-1-core). The backend service keeps
// each storage backend's configuration as one record in the instance database through this Port,
// and packages/database implements it on D1 and on Bun SQLite. Records are saved, listed, read and
// removed, never changed: this change does not edit a saved backend.

/**
 * The fields of a backend's kind other than its secret key. The path-style flag is a boolean and
 * every other field a string ("Field types" in specs/storage-backends).
 */
export type BackendConfig = { readonly [field: string]: string | boolean };

/** One storage backend as the instance database keeps it. */
export interface BackendRecord {
  /** A random UUID that the backend service creates and never reuses. */
  readonly id: string;
  /** Unique among the instance's backends, compared code point by code point. */
  readonly name: string;
  /** The backend's kind. The backend service decides which kinds exist. */
  readonly kind: string;
  readonly config: BackendConfig;
  /** An S3-compatible backend's secret key as the credential cipher sealed it, or null. */
  readonly sealedSecretKey: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/** A save whose name another backend of the instance already has. Nothing was stored. */
export class BackendNameTakenError extends Data.TaggedError("BackendNameTakenError")<{
  readonly backendName: string;
  readonly message: string;
}> {
  constructor({ backendName }: { readonly backendName: string }) {
    super({
      backendName,
      message: `A storage backend named ${JSON.stringify(backendName)} already exists.`,
    });
  }
}

/** A read or a removal of an id that no record has. */
export class BackendNotFoundError extends Data.TaggedError("BackendNotFoundError")<{
  readonly backendId: string;
  readonly message: string;
}> {
  constructor({ backendId }: { readonly backendId: string }) {
    super({ backendId, message: `No storage backend has the id ${backendId}.` });
  }
}

/**
 * The Port through which the backend service keeps its records. Each operation is one statement,
 * and a failure of the database itself is a defect, not an error the service can handle.
 */
export class BackendRecords extends Context.Service<
  BackendRecords,
  {
    /** Stores a new record, or fails without storing it when its name is taken. */
    readonly save: (record: BackendRecord) => Effect.Effect<void, BackendNameTakenError>;
    /** Every record, in the order of their names compared code point by code point. */
    readonly list: Effect.Effect<ReadonlyArray<BackendRecord>>;
    /** The record with this id. */
    readonly read: (id: string) => Effect.Effect<BackendRecord, BackendNotFoundError>;
    /** Deletes the record with this id. */
    readonly remove: (id: string) => Effect.Effect<void, BackendNotFoundError>;
  }
>()("@davloom/core/BackendRecords") {}
