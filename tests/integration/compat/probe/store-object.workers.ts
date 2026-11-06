import { DurableObject } from "cloudflare:workers";
import type { Auth } from "@davloom/auth";
import { Schema } from "effect";
import { decodeJson } from "../shared/json";
import { createProbeAuth, type ProbeEnv } from "./auth.workers";
import { burnCpu } from "./burn";
import { Credentials } from "./identity-routes";

/** One row per MiB keeps every row under SQLite's 2 MB limit on Durable Objects. */
const CHUNK_BYTES = 1024 * 1024;

// Paths and chunks live in separate tables, so moving a file does not rewrite its bytes.
const SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    path TEXT PRIMARY KEY,
    parent TEXT NOT NULL,
    content_id INTEGER NOT NULL,
    size INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS entries_by_parent ON entries (parent);
  CREATE TABLE IF NOT EXISTS chunks (
    content_id INTEGER NOT NULL,
    position INTEGER NOT NULL,
    data BLOB NOT NULL,
    PRIMARY KEY (content_id, position)
  );
`;

const SeedRequest = Schema.Struct({
  parent: Schema.String,
  count: Schema.Number,
  bytes: Schema.Number,
});
type SeedRequest = typeof SeedRequest.Type;

const ChurnRequest = Schema.Struct({
  from: Schema.String,
  to: Schema.String,
  count: Schema.Number,
});
type ChurnRequest = typeof ChurnRequest.Type;

// A type alias rather than an interface, so it meets the row constraint of `sql.exec`.
type EntryRow = {
  readonly path: string;
  readonly content_id: number;
  readonly size: number;
};

const parentOf = (path: string): string => path.slice(0, Math.max(path.lastIndexOf("/"), 1));
const nameOf = (path: string): string => path.slice(path.lastIndexOf("/") + 1);

/** Runs statements and adds up the rows they touched, which is what the Free plan's quota counts. */
const createQueryRunner = (sql: SqlStorage) => {
  const usage = { rowsRead: 0, rowsWritten: 0 };
  return {
    usage,
    run: <Row extends Record<string, SqlStorageValue> = Record<string, SqlStorageValue>>(
      query: string,
      ...bindings: SqlStorageValue[]
    ) => {
      const cursor = sql.exec<Row>(query, ...bindings);
      const rows = cursor.toArray();
      usage.rowsRead += cursor.rowsRead;
      usage.rowsWritten += cursor.rowsWritten;
      return rows;
    },
  };
};

/** A minimal file store, shaped like the planned backend so its measurements carry over. */
export class ProbeStore extends DurableObject<ProbeEnv> {
  private auth: Auth | undefined;

  constructor(ctx: DurableObjectState, env: ProbeEnv) {
    super(ctx, env);
    ctx.storage.sql.exec(SCHEMA);
  }

  override async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname.startsWith("/files/")) {
      const path = decodeURIComponent(pathname.slice("/files".length));
      return request.method === "PUT" ? this.writeFile(path, request) : this.readFile(path);
    }
    if (pathname === "/directories") {
      return this.listDirectory(url.searchParams.get("parent") ?? "/");
    }
    if (pathname === "/directories/seed") {
      return this.seedDirectory(decodeJson(SeedRequest, await request.json()));
    }
    if (pathname === "/directories/churn") {
      return this.churnDirectory(decodeJson(ChurnRequest, await request.json()));
    }
    if (pathname === "/login") {
      this.auth ??= createProbeAuth(this.env.DB, this.env.AUTH_SECRET);
      const body = decodeJson(Credentials, await request.json());
      return this.auth.api.signInEmail({ body, asResponse: true });
    }
    const iterations = pathname.match(/^\/burn\/(\d+)$/)?.[1];
    if (iterations) {
      return Response.json({ value: burnCpu(Number(iterations)) });
    }
    return new Response(null, { status: 404 });
  }

  private nextContentId(run: ReturnType<typeof createQueryRunner>["run"]): number {
    const [row] = run<{ next: number }>(
      "SELECT COALESCE(MAX(content_id), 0) + 1 AS next FROM chunks",
    );
    if (!row) {
      throw new Error("The next content id query returned no row");
    }
    return row.next;
  }

  private async writeFile(path: string, request: Request): Promise<Response> {
    const { run, usage } = createQueryRunner(this.ctx.storage.sql);
    const contentId = this.nextContentId(run);
    const buffer = new Uint8Array(CHUNK_BYTES);
    let filled = 0;
    let chunks = 0;
    let size = 0;

    const flush = (data: ArrayBuffer) => {
      run(
        "INSERT INTO chunks (content_id, position, data) VALUES (?, ?, ?)",
        contentId,
        chunks,
        data,
      );
      chunks += 1;
      filled = 0;
    };

    if (request.body) {
      const reader = request.body.getReader();
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        let offset = 0;
        while (offset < value.byteLength) {
          const copied = Math.min(CHUNK_BYTES - filled, value.byteLength - offset);
          buffer.set(value.subarray(offset, offset + copied), filled);
          filled += copied;
          offset += copied;
          if (filled === CHUNK_BYTES) {
            flush(buffer.buffer);
          }
        }
      }
    }
    if (filled > 0) {
      flush(buffer.slice(0, filled).buffer);
    }

    run(
      "INSERT OR REPLACE INTO entries (path, parent, content_id, size) VALUES (?, ?, ?, ?)",
      path,
      parentOf(path),
      contentId,
      size,
    );
    return Response.json({ size, chunks, ...usage });
  }

  private readFile(path: string): Response {
    const { sql } = this.ctx.storage;
    const [entry] = sql.exec("SELECT content_id FROM entries WHERE path = ?", path).toArray();
    if (!entry) {
      return new Response(null, { status: 404 });
    }
    let position = 0;
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => {
        const [chunk] = sql
          .exec<{ data: ArrayBuffer }>(
            "SELECT data FROM chunks WHERE content_id = ? AND position = ?",
            entry.content_id,
            position,
          )
          .toArray();
        position += 1;
        if (chunk) {
          controller.enqueue(new Uint8Array(chunk.data));
        } else {
          controller.close();
        }
      },
    });
    return new Response(body);
  }

  private listDirectory(parent: string): Response {
    const { run, usage } = createQueryRunner(this.ctx.storage.sql);
    const children = run("SELECT path, size FROM entries WHERE parent = ?", parent);
    return Response.json({ children, ...usage });
  }

  private seedDirectory({ parent, count, bytes }: SeedRequest): Response {
    const { run, usage } = createQueryRunner(this.ctx.storage.sql);
    const data = crypto.getRandomValues(new Uint8Array(bytes)).buffer;
    let contentId = this.nextContentId(run);
    for (let index = 0; index < count; index += 1) {
      run(
        "INSERT INTO entries (path, parent, content_id, size) VALUES (?, ?, ?, ?)",
        `${parent}/object-${index}`,
        parent,
        contentId,
        bytes,
      );
      run("INSERT INTO chunks (content_id, position, data) VALUES (?, 0, ?)", contentId, data);
      contentId += 1;
    }
    return Response.json({ created: count, ...usage });
  }

  /**
   * Copies and then deletes objects one at a time, which is what a directory COPY followed by a
   * DELETE does. The loop has no `await`, so all of it commits or rolls back together.
   */
  private churnDirectory({ from, to, count }: ChurnRequest): Response {
    const { run, usage } = createQueryRunner(this.ctx.storage.sql);
    const sources = run<EntryRow>(
      "SELECT path, content_id, size FROM entries WHERE parent = ? LIMIT ?",
      from,
      count,
    );
    let contentId = this.nextContentId(run);
    for (const source of sources) {
      run(
        "INSERT INTO chunks (content_id, position, data) SELECT ?, position, data FROM chunks WHERE content_id = ?",
        contentId,
        source.content_id,
      );
      run(
        "INSERT INTO entries (path, parent, content_id, size) VALUES (?, ?, ?, ?)",
        `${to}/${nameOf(source.path)}`,
        to,
        contentId,
        source.size,
      );
      run("DELETE FROM chunks WHERE content_id = ?", source.content_id);
      run("DELETE FROM entries WHERE path = ?", source.path);
      contentId += 1;
    }
    return Response.json({ moved: sources.length, ...usage });
  }
}
