import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expectationOf,
  requestFor,
  ROWS,
  type Row,
} from "../../../../packages/webdav/src/tables/permission-oracle";
import { COLLECTIONS, FILES, type MountState } from "../../../../packages/webdav/src/tables/world";
import { basic, startDavloom, startWorkersServer, stringField, type Davloom } from "./davloom";
import { hasDocker, startSelfHostedServer } from "./selfhosted";
import type { Server } from "./servers";

// The exhaustive permission table of PRD §11 against real deployments: real API Keys of each
// access level and scope, made through the management API, sent by Basic Auth over HTTP to the
// production Worker (D1 and Durable Objects) and to the Bun, SQLite and RustFS stack. The oracle
// is the one the in-process table uses (packages/webdav/src/tables/permission-oracle.ts).
//
// The `files` Mount steps through its three states: it exists; its backend is unavailable (an S3
// backend whose endpoint answers nothing); it is gone. A real deployment refuses to make or keep a
// key limited to a Mount that does not exist (MountInUse), so with `files` gone only keys without
// a scope remain: the 360 cases of scoped keys on a missing Mount exist in-process only.

const TARGETS: [string, () => Promise<Server>, boolean][] = [
  ["Workers with D1 and Durable Objects", startWorkersServer, false],
  ["Bun with SQLite and RustFS", startSelfHostedServer, !hasDocker()],
];

const STATES: readonly MountState[] = ["exists", "unavailable", "missing"];

/** Methods that can change what the tree holds, after which the test puts it back. */
const CHANGES = new Set(["PUT", "MKCOL", "DELETE", "PROPPATCH", "COPY", "MOVE", "LOCK"]);

/** The roots of a scope, as the API takes them. */
const pathsOf = (row: Row) => row.scope.roots?.map((root) => `/${root.join("/")}`);

const keyName = (row: Row) => `${row.access}|${row.scope.name}`;

const json = (value: unknown) => JSON.stringify(value);

const idsOf = (value: unknown, name: string) =>
  (Array.isArray(value) ? value : []).filter((item: unknown) => stringField(item, "name") === name);

describe.each(TARGETS)("the permission table on %s", (_target, start, skip) => {
  let davloom: Davloom;
  const keys = new Map<string, { id: string; key: string }>();
  let filesMount = "";

  const admin = (path: string, init: RequestInit = {}) => davloom.dav(path, init);

  /** Puts the files of the world back, in the Mounts that work in this state. */
  const restore = async (state: MountState) => {
    const mounts = state === "exists" ? ["files", "media"] : ["media"];
    const roots = COLLECTIONS.filter((c) => c.split("/").length === 2);
    for (const root of roots) {
      if (mounts.includes(root.split("/")[0] ?? "")) await admin(`/${root}/`, { method: "DELETE" });
    }
    for (const collection of COLLECTIONS) {
      if (!mounts.includes(collection.split("/")[0] ?? "")) continue;
      const made = await admin(`/${collection}/`, { method: "MKCOL" });
      expect(made.status, `MKCOL ${collection}`).toBe(201);
    }
    for (const [file, content] of Object.entries(FILES)) {
      if (!mounts.includes(file.split("/")[0] ?? "")) continue;
      const put = await admin(`/${file}`, { method: "PUT", body: content });
      expect(put.status, `PUT ${file}`).toBe(201);
    }
  };

  /** The files of the world as the read-write key without a scope reads them. */
  const contents = async (state: MountState) => {
    const result: Record<string, string> = {};
    for (const file of Object.keys(FILES)) {
      if (state !== "exists" && file.startsWith("files/")) continue;
      const read = await admin(`/${file}`);
      result[file] = read.status === 200 ? await read.text() : `<${read.status}>`;
    }
    return result;
  };

  beforeAll(async () => {
    if (skip) return;
    davloom = await startDavloom(start);
    // `media` is a Mount of a folder of the default backend, so it outlives the `files` Mount.
    expect((await admin("/files/media-root/", { method: "MKCOL" })).status).toBe(201);
    const backends: unknown = await (await davloom.api("/api/backends")).json();
    const backendId = stringField(Array.isArray(backends) ? backends[0] : null, "id");
    const media = await davloom.api("/api/mounts", {
      method: "POST",
      body: json({ name: "media", backendId, root: "media-root" }),
    });
    expect(media.status).toBe(201);
    const mounts: unknown = await (await davloom.api("/api/mounts")).json();
    filesMount = stringField(idsOf(mounts, "files")[0], "id");
    for (const row of ROWS) {
      if (keys.has(keyName(row))) continue;
      const created = await davloom.api("/api/keys", {
        method: "POST",
        body: json({ name: keyName(row), access: row.access, paths: pathsOf(row) }),
      });
      expect(created.status, keyName(row)).toBe(201);
      const body: unknown = await created.json();
      keys.set(keyName(row), { id: stringField(body, "id"), key: stringField(body, "key") });
    }
  }, 180_000);
  afterAll(async () => {
    await davloom?.server.stop();
  });

  describe.each(STATES)("with the files Mount %s", (state) => {
    beforeAll(async () => {
      if (skip) return;
      if (state === "unavailable") {
        // An S3 backend whose endpoint answers nothing: every call to it fails as unavailable.
        const created = await davloom.api("/api/backends", {
          method: "POST",
          body: json({
            name: "Down",
            kind: "s3",
            config: {
              endpoint: "http://127.0.0.1:9",
              region: "us-east-1",
              bucket: "down",
              forcePathStyle: true,
              accessKeyId: "down",
            },
            secretKey: "down-secret-key",
          }),
        });
        expect(created.status).toBe(201);
        const backendId = stringField(await created.json(), "id");
        const moved = await davloom.api(`/api/mounts/${filesMount}`, {
          method: "PATCH",
          body: json({ backendId, root: "" }),
        });
        expect(moved.status).toBe(200);
      }
      if (state === "missing") {
        // Keys limited to the Mount keep it from going; only keys without a scope remain.
        for (const [name, { id }] of keys) {
          if (!name.endsWith("|no scope")) {
            expect((await davloom.api(`/api/keys/${id}`, { method: "DELETE" })).status).toBe(200);
          }
        }
        expect((await davloom.api(`/api/mounts/${filesMount}`, { method: "DELETE" })).status).toBe(
          200,
        );
      }
      await restore(state);
    }, 120_000);

    const rows = ROWS.filter(
      (row) => row.state === state && (state !== "missing" || row.scope.roots === null),
    ).map((row) => [row.access, row.scope.name, row.method, row.relation, row] as const);

    it.skipIf(skip).each(rows)(
      "%s key, %s, %s on the %s target",
      { timeout: 60_000 },
      async (_access, _scope, method, _relation, row) => {
        const expected = expectationOf(row);
        const key = keys.get(keyName(row))?.key ?? "";
        const call = requestFor(method, expected.target);
        const before = expected.permitted ? null : await contents(state);
        const response = await davloom.server.fetch(`/dav${expected.url}`, {
          method,
          headers: { authorization: basic(key), ...call.headers },
          body: call.body,
        });
        const token = response.headers.get("lock-token");
        await response.body?.cancel();
        // Any lock goes before anything is asserted, so a failed case leaves none behind.
        const unlocked =
          method === "LOCK" && token
            ? await davloom.server.fetch(`/dav${expected.url}`, {
                method: "UNLOCK",
                headers: { authorization: basic(key), "lock-token": token },
              })
            : null;
        if (CHANGES.has(method) && response.status < 300) await restore(state);
        expect(expected.statuses).toContain(response.status);
        if (unlocked) expect(unlocked.status).toBe(204);
        if (before !== null) {
          // A refused request changes nothing.
          expect(await contents(state)).toEqual(before);
        }
      },
    );
  });
});
