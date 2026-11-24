// The Storage Port. Each storage backend presents a tree of collections and files. Operations
// return results instead of throwing, so the same interface crosses Workers RPC to a Durable Object
// unchanged. Every adapter decides outcomes with the proven decisions of @davloom/laws, from facts it
// gathers from its own storage, so every backend answers the same way and in the same order.

/** A path in a backend: a list of names. The root is the empty list. */
export type Path = readonly string[];

export type EntryKind = "file" | "collection";

export interface Entry {
  readonly path: Path;
  readonly kind: EntryKind;
  /** Bytes of a file; 0 for a collection. */
  readonly size: number;
  /** An opaque tag that changes whenever the file's content changes; no quotes. */
  readonly etag: string;
  /** Milliseconds since the epoch. */
  readonly modified: number;
  readonly created: number;
  readonly contentType: string | null;
}

/** A dead property: its name in Clark notation (`{namespace}local`) and its XML element. */
export interface DeadProperty {
  readonly name: string;
  readonly xml: string;
}

export type StorageFailure =
  | "not-found"
  | "no-parent"
  | "exists"
  | "is-collection"
  | "not-collection"
  | "into-itself"
  | "root"
  | "insufficient-storage"
  | "too-large"
  | "size-mismatch"
  | "unavailable"
  /**
   * An object-store collection that holds objects whose keys form no valid path, or that hides a
   * file of the same name: removing, copying or moving it would lose or expose them.
   */
  | "hidden-objects"
  /**
   * The backend's store refuses a name that the namespace allows, for good: an S3-compatible store
   * that keeps objects as files may refuse a key with a control character, a part that it trims to
   * `.` or `..`, or a collection marker longer than its file system takes. Retrying cannot help,
   * and nothing changed. A read or a listing of such a name finds nothing, since no object can
   * have it.
   */
  | "name-refused"
  /**
   * A copy or move that was to replace its destination, refused as `name-refused` once the
   * destination was removed: the source is whole and nothing arrived at the destination, but what
   * stood there is gone.
   */
  | "name-refused-replaced"
  /** A copy or move between two backends, which the server does not perform. */
  | "cross-backend"
  /**
   * A copy or move of more entries than the backend handles in one request (PRD §5). It changed
   * nothing; the client can copy or move the collection in parts.
   */
  | "too-many";

export type StorageResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly failure: StorageFailure };

export const ok = <T>(value: T): StorageResult<T> => ({ ok: true, value });
export const fail = <T = never>(failure: StorageFailure): StorageResult<T> => ({
  ok: false,
  failure,
});

/** Bytes from `start` up to, not including, `stop`. */
export interface ByteRange {
  readonly start: number;
  readonly stop: number;
}

export interface ReadResult {
  readonly entry: Entry;
  readonly body: ReadableStream<Uint8Array>;
}

export interface WriteOptions {
  /** The size the client stated, when it stated one; the write fails if the body differs. */
  readonly size?: number | undefined;
  readonly contentType?: string | null | undefined;
  /** Create only: fail with `exists` when the path holds anything at commit time. */
  readonly ifAbsent?: boolean | undefined;
}

export interface Usage {
  readonly files: number;
  readonly collections: number;
  readonly bytes: number;
  /**
   * When the counts were measured, in milliseconds since the epoch, for a backend that answers
   * from an earlier count rather than counting now (an object store lists its whole bucket to
   * count); absent when the counts are current.
   */
  readonly measuredAt?: number;
}

export interface StorageBackend {
  stat(path: Path): Promise<StorageResult<Entry>>;
  /** The entries directly inside a collection. */
  list(path: Path): Promise<StorageResult<readonly Entry[]>>;
  read(path: Path, range?: ByteRange): Promise<StorageResult<ReadResult>>;
  write(
    path: Path,
    body: ReadableStream<Uint8Array> | null,
    options: WriteOptions,
  ): Promise<StorageResult<{ readonly entry: Entry; readonly created: boolean }>>;
  createCollection(path: Path): Promise<StorageResult<Entry>>;
  remove(path: Path): Promise<StorageResult<null>>;
  /** Copies a subtree, or only the collection itself when `shallow` (Depth: 0). */
  copy(
    from: Path,
    to: Path,
    options: { readonly overwrite: boolean; readonly shallow: boolean },
  ): Promise<StorageResult<{ readonly replaced: boolean }>>;
  move(
    from: Path,
    to: Path,
    options: { readonly overwrite: boolean },
  ): Promise<StorageResult<{ readonly replaced: boolean }>>;
  /** The dead properties of each path that exists, keyed by `pathKey`. */
  properties(
    paths: readonly Path[],
  ): Promise<StorageResult<Record<string, readonly DeadProperty[]>>>;
  /** Sets and removes dead properties of one entry, all or nothing. */
  patchProperties(
    path: Path,
    set: readonly DeadProperty[],
    remove: readonly string[],
  ): Promise<StorageResult<null>>;
  usage(): Promise<StorageResult<Usage>>;
  /**
   * The bytes stored and the bytes still free where `path` lives (RFC 4331), when the backend
   * knows its limit; `available` is null for a backend without one.
   */
  quota?(path: Path): Promise<StorageResult<Quota>>;
  /**
   * Asks the backend's store whether it answers, with the store's own reason when it does not,
   * such as a bucket that does not exist. A backend without one is checked with a stat of its root.
   */
  check?(): Promise<BackendCheck>;
  /**
   * Gives up what Davloom keeps for the backend outside its records, once the backend is removed:
   * a Durable Object deletes its storage, and fails with `exists` while it holds any entry, since
   * nothing could reach that entry afterwards; an object store drops the dead properties Davloom
   * kept for it and leaves every object in its bucket.
   */
  release?(): Promise<StorageResult<null>>;
}

export type BackendCheck = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface Quota {
  readonly used: number;
  readonly available: number | null;
}

/** A key that names a path uniquely: names cannot hold `/`. */
export const pathKey = (path: Path): string => path.join("/");

export const parentOf = (path: Path): Path => path.slice(0, -1);

/** Whether `inner` equals `outer` or lies under it. */
export const isWithin = (inner: Path, outer: Path): boolean =>
  inner.length >= outer.length && outer.every((name, index) => inner[index] === name);

/** The failure that a proven decision other than "proceed" reports. */
export const failureOf = (
  outcome: "missing" | "no-parent" | "exists" | "is-collection" | "into-itself" | "root",
): StorageFailure => (outcome === "missing" ? "not-found" : outcome);
