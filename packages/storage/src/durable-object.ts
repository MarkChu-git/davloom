import { DurableObject } from "cloudflare:workers";
import {
  fail,
  failureOf,
  isWithin,
  ok,
  parentOf,
  pathKey,
  type ByteRange,
  type DeadProperty,
  type Entry,
  type Path,
  type ReadResult,
  type StorageBackend,
  type StorageFailure,
  type StorageResult,
  type Usage,
  type WriteOptions,
} from "@davloom/core";
import {
  decideCopy,
  decideMkcol,
  decideMove,
  decideRemove,
  decideWrite,
  type Node,
} from "@davloom/laws";

// One Durable Object holds one storage backend (owner decision of 2026-11-19). Entries form a tree
// by id: each row names its parent's id, so moving a collection rewrites one row however large it
// is. File content lives in chunks of 1 MiB, under the 2 MB row limit, keyed by a content id that
// every write takes fresh, and a file's ETag is its content id. Every operation decides with the
// proven decisions of @davloom/laws and commits in one synchronous transaction.

/** Bytes per chunk row. Every chunk but a file's last holds exactly this many. */
export const CHUNK_BYTES = 1024 * 1024;

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    id INTEGER PRIMARY KEY,
    parent INTEGER NOT NULL,
    name TEXT NOT NULL,
    kind INTEGER NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    content INTEGER,
    created INTEGER NOT NULL,
    modified INTEGER NOT NULL,
    content_type TEXT,
    UNIQUE (parent, name)
  );
  CREATE INDEX IF NOT EXISTS entries_by_content ON entries (content);
  CREATE TABLE IF NOT EXISTS chunks (
    content INTEGER NOT NULL,
    position INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (content, position)
  );
  CREATE TABLE IF NOT EXISTS properties (
    entry INTEGER NOT NULL,
    name TEXT NOT NULL,
    xml TEXT NOT NULL,
    PRIMARY KEY (entry, name)
  );
  CREATE TABLE IF NOT EXISTS pending (content INTEGER PRIMARY KEY);
  CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
`;

const FILE = 0;
const COLLECTION = 1;
const ROOT = 0;

// Type aliases, not interfaces, so they meet the row constraint of `sql.exec`.
type EntryRow = {
  id: number;
  parent: number;
  name: string;
  kind: number;
  size: number;
  content: number | null;
  created: number;
  modified: number;
  content_type: string | null;
};
type SubtreeRow = EntryRow & { depth: number };

const ENTRY_COLUMNS = "id, parent, name, kind, size, content, created, modified, content_type";

/** The root has no row of its own. */
interface Resolved {
  readonly row: EntryRow | null;
  readonly node: Node;
}

class StorageFull extends Error {}

const isFull = (error: unknown) =>
  error instanceof Error && /SQLITE_FULL|database or disk is full/i.test(error.message);

const etagOf = (row: EntryRow) =>
  row.kind === FILE
    ? `f${(row.content ?? 0).toString(36)}`
    : `c${row.id.toString(36)}-${row.modified.toString(36)}`;

export class StorageObject extends DurableObject {
  private readonly sql: SqlStorage;

  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    void ctx.blockConcurrencyWhile(() => {
      this.sql.exec(SCHEMA);
      // Content that a write left behind when the object stopped in the middle of it.
      this.sql.exec(
        "DELETE FROM chunks WHERE content IN (SELECT content FROM pending) AND content NOT IN (SELECT content FROM entries WHERE content IS NOT NULL)",
      );
      this.sql.exec("DELETE FROM pending");
      return Promise.resolve();
    });
  }

  // --- Helpers -------------------------------------------------------------------------------

  /** Runs an insert or update; a full object raises StorageFull. */
  protected change(query: string, ...bindings: SqlStorageValue[]): void {
    try {
      this.insertOrUpdate(query, bindings);
    } catch (error) {
      if (isFull(error)) throw new StorageFull();
      throw error;
    }
  }

  /** The statement behind `change`. The contract tests override it to simulate a full object. */
  protected insertOrUpdate(query: string, bindings: SqlStorageValue[]): void {
    this.sql.exec(query, ...bindings);
  }

  // oxlint-disable-next-line typescript/no-unnecessary-type-parameters -- names the row type of the query
  private one<Row extends Record<string, SqlStorageValue>>(
    query: string,
    ...bindings: SqlStorageValue[]
  ): Row | null {
    return this.sql.exec<Row>(query, ...bindings).toArray()[0] ?? null;
  }

  private meta(key: string, fallback: number): number {
    return (
      this.one<{ value: number }>("SELECT value FROM meta WHERE key = ?", key)?.value ?? fallback
    );
  }

  private setMeta(key: string, value: number) {
    this.change(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
      key,
      value,
    );
  }

  private nextContent(): number {
    const next = this.meta("content", 0) + 1;
    this.setMeta("content", next);
    return next;
  }

  private resolve(path: Path): Resolved {
    if (path.length === 0) return { row: null, node: "collection" };
    let parent = ROOT;
    let row: EntryRow | null = null;
    for (const [index, name] of path.entries()) {
      row = this.one<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM entries WHERE parent = ? AND name = ?`,
        parent,
        name,
      );
      if (!row) return { row: null, node: "absent" };
      if (row.kind === FILE && index < path.length - 1) return { row: null, node: "absent" };
      parent = row.id;
    }
    return { row, node: row?.kind === COLLECTION ? "collection" : "file" };
  }

  private idOf(resolved: Resolved): number {
    return resolved.row?.id ?? ROOT;
  }

  private rootEntry(): Entry {
    const created = this.meta("created", 0);
    const modified = this.meta("modified", created);
    return {
      path: [],
      kind: "collection",
      size: 0,
      etag: `r${modified.toString(36)}`,
      modified,
      created,
      contentType: null,
    };
  }

  private entryOf(path: Path, row: EntryRow): Entry {
    return {
      path,
      kind: row.kind === COLLECTION ? "collection" : "file",
      size: row.size,
      etag: etagOf(row),
      modified: row.modified,
      created: row.created,
      contentType: row.content_type,
    };
  }

  private touch(id: number, time: number) {
    if (id === ROOT) this.setMeta("modified", time);
    else
      this.change(
        "UPDATE entries SET modified = ? WHERE id = ? AND kind = ?",
        time,
        id,
        COLLECTION,
      );
  }

  private subtree(id: number): SubtreeRow[] {
    return this.sql
      .exec<SubtreeRow>(
        `WITH RECURSIVE t(id, depth) AS (SELECT ?, 0 UNION ALL SELECT e.id, t.depth + 1 FROM entries e JOIN t ON e.parent = t.id)
         SELECT ${ENTRY_COLUMNS.split(", ")
           .map((c) => `e.${c}`)
           .join(", ")}, t.depth FROM t JOIN entries e ON e.id = t.id ORDER BY t.depth`,
        id,
      )
      .toArray();
  }

  private deleteTree(id: number) {
    const ids = this.subtree(id).map((row) => row.id);
    for (const entry of ids) {
      this.sql.exec(
        "DELETE FROM chunks WHERE content IN (SELECT content FROM entries WHERE id = ? AND content IS NOT NULL)",
        entry,
      );
      this.sql.exec("DELETE FROM properties WHERE entry = ?", entry);
    }
    for (const entry of ids.toReversed()) this.sql.exec("DELETE FROM entries WHERE id = ?", entry);
  }

  private transaction<T>(run: () => StorageResult<T>): StorageResult<T> {
    try {
      return this.ctx.storage.transactionSync(run);
    } catch (error) {
      if (error instanceof StorageFull) return fail("insufficient-storage");
      throw error;
    }
  }

  // --- The Storage Port ----------------------------------------------------------------------

  stat(path: Path): StorageResult<Entry> {
    if (path.length === 0) return ok(this.rootEntry());
    const { row } = this.resolve(path);
    return row ? ok(this.entryOf(path, row)) : fail("not-found");
  }

  list(path: Path): StorageResult<readonly Entry[]> {
    const resolved = this.resolve(path);
    if (resolved.node === "absent") return fail("not-found");
    if (resolved.node === "file") return fail("not-collection");
    const rows = this.sql
      .exec<EntryRow>(
        `SELECT ${ENTRY_COLUMNS} FROM entries WHERE parent = ? ORDER BY name`,
        this.idOf(resolved),
      )
      .toArray();
    return ok(rows.map((row) => this.entryOf([...path, row.name], row)));
  }

  read(path: Path, range?: ByteRange): StorageResult<ReadResult> {
    const resolved = this.resolve(path);
    if (resolved.node === "absent") return fail("not-found");
    if (resolved.node === "collection" || !resolved.row) return fail("is-collection");
    const row = resolved.row;
    const content = row.content ?? 0;
    const start = range?.start ?? 0;
    const stop = range?.stop ?? row.size;
    let position = Math.floor(start / CHUNK_BYTES);
    const sql = this.sql;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        const offset = position * CHUNK_BYTES;
        if (offset >= stop) {
          controller.close();
          return;
        }
        const chunk = sql
          .exec<{ data: ArrayBuffer }>(
            "SELECT data FROM chunks WHERE content = ? AND position = ?",
            content,
            position,
          )
          .toArray()[0];
        if (!chunk) {
          // The file was replaced or removed while it was read: fail rather than end short.
          controller.error(new Error("the file changed while it was read"));
          return;
        }
        const bytes = new Uint8Array(chunk.data);
        const from = Math.max(0, start - offset);
        const to = Math.min(bytes.length, stop - offset);
        controller.enqueue(bytes.subarray(from, to));
        position += 1;
      },
    });
    return ok({ entry: this.entryOf(path, row), body });
  }

  async write(
    path: Path,
    body: ReadableStream<Uint8Array> | null,
    options: WriteOptions,
  ): Promise<StorageResult<{ readonly entry: Entry; readonly created: boolean }>> {
    const decide = () => {
      const target = this.resolve(path);
      const parent = this.resolve(parentOf(path));
      return { target, parent, outcome: decideWrite(target.node, parent.node) };
    };
    const first = decide().outcome;
    if (first.kind !== "proceed") {
      await body?.cancel();
      return fail(failureOf(first.kind));
    }

    let content: number;
    try {
      content = this.ctx.storage.transactionSync(() => {
        const id = this.nextContent();
        this.change("INSERT INTO pending (content) VALUES (?)", id);
        return id;
      });
    } catch (error) {
      await body?.cancel();
      if (error instanceof StorageFull) return fail("insufficient-storage");
      throw error;
    }
    const discard = () => {
      this.sql.exec("DELETE FROM chunks WHERE content = ?", content);
      this.sql.exec("DELETE FROM pending WHERE content = ?", content);
    };

    // Store the body in chunks of exactly CHUNK_BYTES as it arrives.
    let size = 0;
    let position = 0;
    let buffer = new Uint8Array(CHUNK_BYTES);
    let filled = 0;
    const flush = () => {
      this.change(
        "INSERT INTO chunks (content, position, data) VALUES (?, ?, ?)",
        content,
        position,
        buffer.slice(0, filled).buffer,
      );
      position += 1;
      filled = 0;
      buffer = new Uint8Array(CHUNK_BYTES);
    };
    let failure: StorageFailure | null = null;
    try {
      const reader = body?.getReader();
      for (;;) {
        if (!reader) break;
        const { done, value } = await reader.read();
        if (done) break;
        size += value.length;
        if (options.size !== undefined && size > options.size) {
          failure = "size-mismatch";
          await reader.cancel();
          break;
        }
        let offset = 0;
        while (offset < value.length) {
          const take = Math.min(CHUNK_BYTES - filled, value.length - offset);
          buffer.set(value.subarray(offset, offset + take), filled);
          filled += take;
          offset += take;
          if (filled === CHUNK_BYTES) flush();
        }
      }
      if (failure === null && filled > 0) flush();
    } catch (error) {
      failure = error instanceof StorageFull ? "insufficient-storage" : "size-mismatch";
    }
    if (failure === null && options.size !== undefined && size !== options.size)
      failure = "size-mismatch";
    if (failure !== null) {
      discard();
      return fail(failure);
    }

    // The tree may have changed while the bytes arrived, so decide again and commit at once.
    const result = this.transaction(() => {
      const { target, parent, outcome } = decide();
      if (outcome.kind !== "proceed")
        return fail<{ entry: Entry; created: boolean }>(failureOf(outcome.kind));
      const time = Date.now();
      const contentType = options.contentType ?? null;
      if (target.row) {
        this.sql.exec("DELETE FROM chunks WHERE content = ?", target.row.content ?? 0);
        this.change(
          "UPDATE entries SET size = ?, content = ?, modified = ?, content_type = ? WHERE id = ?",
          size,
          content,
          time,
          contentType,
          target.row.id,
        );
      } else {
        this.change(
          "INSERT INTO entries (parent, name, kind, size, content, created, modified, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
          this.idOf(parent),
          path.at(-1) ?? "",
          FILE,
          size,
          content,
          time,
          time,
          contentType,
        );
      }
      this.sql.exec("DELETE FROM pending WHERE content = ?", content);
      if (!target.row) this.touch(this.idOf(parent), time);
      const row = this.resolve(path).row;
      return row
        ? ok({ entry: this.entryOf(path, row), created: !outcome.replaces })
        : fail("unavailable");
    });
    if (!result.ok) discard();
    return result;
  }

  createCollection(path: Path): StorageResult<Entry> {
    return this.transaction(() => {
      const target = this.resolve(path);
      const parent = this.resolve(parentOf(path));
      const outcome = decideMkcol(
        path.length === 0,
        target.node,
        path.length === 0 ? "absent" : parent.node,
      );
      if (outcome.kind !== "proceed") return fail(failureOf(outcome.kind));
      const time = Date.now();
      this.change(
        "INSERT INTO entries (parent, name, kind, created, modified) VALUES (?, ?, ?, ?, ?)",
        this.idOf(parent),
        path.at(-1) ?? "",
        COLLECTION,
        time,
        time,
      );
      this.touch(this.idOf(parent), time);
      const row = this.resolve(path).row;
      return row ? ok(this.entryOf(path, row)) : fail("unavailable");
    });
  }

  remove(path: Path): StorageResult<null> {
    return this.transaction(() => {
      const target = this.resolve(path);
      const outcome = decideRemove(path.length === 0, target.node);
      if (outcome.kind !== "proceed" || !target.row)
        return fail(failureOf(outcome.kind === "proceed" ? "root" : outcome.kind));
      this.deleteTree(target.row.id);
      try {
        this.touch(target.row.parent, Date.now());
      } catch (error) {
        // A full object still removes: only the parent's time stays as it was.
        if (!(error instanceof StorageFull)) throw error;
      }
      return ok(null);
    });
  }

  private transfer(
    from: Path,
    to: Path,
    overwrite: boolean,
    move: boolean,
    shallow: boolean,
  ): StorageResult<{ readonly replaced: boolean }> {
    return this.transaction(() => {
      const source = this.resolve(from);
      const destination = this.resolve(to);
      const destinationParent =
        to.length === 0 ? ({ row: null, node: "absent" } as const) : this.resolve(parentOf(to));
      const facts = {
        sourceIsRoot: from.length === 0,
        source: source.node,
        inside: isWithin(to, from),
        destinationIsRoot: to.length === 0,
        destination: destination.node,
        destinationParent: destinationParent.node,
        overwrite,
      };
      const outcome = move ? decideMove(facts) : decideCopy(facts);
      if (outcome.kind !== "proceed" || !source.row)
        return fail(failureOf(outcome.kind === "proceed" ? "root" : outcome.kind));
      if (destination.row) this.deleteTree(destination.row.id);
      const parentId = this.idOf(destinationParent);
      const name = to.at(-1) ?? "";
      const time = Date.now();
      if (move) {
        this.change(
          "UPDATE entries SET parent = ?, name = ? WHERE id = ?",
          parentId,
          name,
          source.row.id,
        );
        this.touch(source.row.parent, time);
      } else {
        const rows = shallow ? [{ ...source.row, depth: 0 }] : this.subtree(source.row.id);
        const ids = new Map<number, number>();
        for (const row of rows) {
          const newParent = row.depth === 0 ? parentId : (ids.get(row.parent) ?? parentId);
          const content = row.kind === FILE ? this.nextContent() : null;
          this.change(
            "INSERT INTO entries (parent, name, kind, size, content, created, modified, content_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            newParent,
            row.depth === 0 ? name : row.name,
            row.kind,
            row.size,
            content,
            time,
            time,
            row.content_type,
          );
          const id =
            this.one<{ id: number }>(
              "SELECT id FROM entries WHERE parent = ? AND name = ?",
              newParent,
              row.depth === 0 ? name : row.name,
            )?.id ?? 0;
          ids.set(row.id, id);
          if (content !== null) {
            this.change(
              "INSERT INTO chunks (content, position, data) SELECT ?, position, data FROM chunks WHERE content = ?",
              content,
              row.content ?? 0,
            );
          }
          this.change(
            "INSERT INTO properties (entry, name, xml) SELECT ?, name, xml FROM properties WHERE entry = ?",
            id,
            row.id,
          );
        }
      }
      this.touch(parentId, time);
      return ok({ replaced: outcome.replaces });
    });
  }

  copy(from: Path, to: Path, options: { readonly overwrite: boolean; readonly shallow: boolean }) {
    return this.transfer(from, to, options.overwrite, false, options.shallow);
  }

  move(from: Path, to: Path, options: { readonly overwrite: boolean }) {
    return this.transfer(from, to, options.overwrite, true, false);
  }

  properties(paths: readonly Path[]): StorageResult<Record<string, readonly DeadProperty[]>> {
    const result: Record<string, readonly DeadProperty[]> = {};
    for (const path of paths) {
      const resolved = this.resolve(path);
      if (resolved.node === "absent") continue;
      result[pathKey(path)] = this.sql
        .exec<{ name: string; xml: string }>(
          "SELECT name, xml FROM properties WHERE entry = ? ORDER BY name",
          this.idOf(resolved),
        )
        .toArray();
    }
    return ok(result);
  }

  patchProperties(
    path: Path,
    set: readonly DeadProperty[],
    remove: readonly string[],
  ): StorageResult<null> {
    return this.transaction(() => {
      const resolved = this.resolve(path);
      if (resolved.node === "absent") return fail("not-found");
      const id = this.idOf(resolved);
      for (const property of set) {
        this.change(
          "INSERT INTO properties (entry, name, xml) VALUES (?, ?, ?) ON CONFLICT (entry, name) DO UPDATE SET xml = excluded.xml",
          id,
          property.name,
          property.xml,
        );
      }
      for (const name of remove)
        this.sql.exec("DELETE FROM properties WHERE entry = ? AND name = ?", id, name);
      return ok(null);
    });
  }

  usage(): StorageResult<Usage> {
    const row = this.one<{ files: number; collections: number; bytes: number }>(
      "SELECT COALESCE(SUM(kind = 0), 0) AS files, COALESCE(SUM(kind = 1), 0) AS collections, COALESCE(SUM(size), 0) AS bytes FROM entries",
    );
    return ok(row ?? { files: 0, collections: 0, bytes: 0 });
  }

  /** Deletes everything when the root holds nothing; for removing the backend. */
  async destroyIfEmpty(): Promise<StorageResult<null>> {
    if (this.one("SELECT id FROM entries LIMIT 1")) return fail("exists");
    await this.ctx.storage.deleteAll();
    return ok(null);
  }
}

/** The Storage Port of one backend, reached through Workers RPC. */
export const durableObjectStorage = (
  namespace: DurableObjectNamespace<StorageObject>,
  backendId: string,
): StorageBackend => {
  const id = namespace.idFromName(backendId);
  // A stub belongs to the request that made it, so every call gets its own. RPC results arrive as
  // plain copies of what the object returned.
  const call = async <T>(
    run: (stub: DurableObjectStub<StorageObject>) => Promise<unknown>,
  ): Promise<StorageResult<T>> => {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the object's methods return StorageResult<T>; RPC types wrap them
      return (await run(namespace.get(id))) as StorageResult<T>;
    } catch (error) {
      console.error("storage object call failed", error);
      return fail("unavailable");
    }
  };
  return {
    stat: (path) => call((stub) => stub.stat(path)),
    list: (path) => call((stub) => stub.list(path)),
    read: (path, range) => call((stub) => stub.read(path, range)),
    write: (path, body, options) => call((stub) => stub.write(path, body, options)),
    createCollection: (path) => call((stub) => stub.createCollection(path)),
    remove: (path) => call((stub) => stub.remove(path)),
    copy: (from, to, options) => call((stub) => stub.copy(from, to, options)),
    move: (from, to, options) => call((stub) => stub.move(from, to, options)),
    properties: (paths) => call((stub) => stub.properties(paths)),
    patchProperties: (path, set, remove) => call((stub) => stub.patchProperties(path, set, remove)),
    usage: () => call((stub) => stub.usage()),
  };
};
