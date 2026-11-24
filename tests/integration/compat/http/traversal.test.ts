import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  expected,
  OUTSIDE_CONTENT,
  outside,
  prefixOf,
  requestOf,
  resolve,
  SCOPE_KEY,
  TABLE,
} from "../../../../packages/webdav/src/tables/traversal-cases";
import { COLLECTIONS, FILES } from "../../../../packages/webdav/src/tables/world";
import { basic, startDavloom, stringField, type Davloom } from "./davloom";
import { build, folderAt, snapshot, TARGETS, type Folder } from "./tables";

// The path traversal table of packages/webdav/src/tables/traversal.test.ts over HTTP, against each
// deployment, for a Read / Write key limited to /files/photos. The world's `files` tree is written
// into the `files` Mount with PUT and MKCOL. The deployment has that one Mount, not the in-process
// world's `media`: the media paths are outside the scope either way, and the policy refuses them
// before storage is asked. Each case is one real request; afterwards the tree is compared with the
// one built, and rebuilt when the case changed it, so every case starts from the same world.

/** The world's `files` tree, as `build` takes it. */
const TREE: Record<string, string> = Object.fromEntries([
  ...COLLECTIONS.filter((path) => path.startsWith("files/")).map((path) => [
    `${path.slice("files".length)}/`,
    "",
  ]),
  ...Object.entries(FILES)
    .filter(([path]) => path.startsWith("files/"))
    .map(([path, content]) => [path.slice("files".length), content]),
]);

describe.each(TARGETS)("path traversal and encoding on %s", (_name, start, skip) => {
  let davloom: Davloom | undefined;
  let files: Folder;
  let key = "";
  let before: Record<string, string> = {};

  /** The `files` tree, keyed like the in-process snapshot: `files/photos/a.jpg`. */
  const tree = async () =>
    Object.fromEntries(
      Object.entries(await snapshot(files, "", { content: false })).map(([path, value]) => [
        `files${path}`,
        value,
      ]),
    );

  beforeAll(async () => {
    if (skip) return;
    davloom = await startDavloom(start);
    files = folderAt(davloom, "/dav/files");
    await build(files, TREE);
    const created = await davloom.api("/api/keys", {
      method: "POST",
      body: JSON.stringify({ name: "traversal", access: "read-write", paths: [`/${SCOPE_KEY}`] }),
    });
    key = stringField(await created.json(), "key");
    before = await tree();
  }, 180_000);
  afterAll(async () => {
    await davloom?.server.stop();
  });

  /** Rebuilds each top-level folder of the world whose tree a case changed. */
  const restore = async (after: Record<string, string>) => {
    const changed = new Set(
      [...Object.keys(after), ...Object.keys(before)]
        .filter((path) => after[path] !== before[path])
        .map((path) => path.split("/")[1] ?? ""),
    );
    for (const name of changed) {
      await (await files.dav("DELETE", `/${encodeURIComponent(name)}`)).body?.cancel();
      await build(
        files,
        Object.fromEntries(Object.entries(TREE).filter(([path]) => path.startsWith(`/${name}/`))),
      );
    }
    before = await tree();
  };

  it.skipIf(skip).each(TABLE)("%s with %s", async (entry, _label, payload) => {
    if (!davloom) throw new Error("no server");
    const origin = davloom.server.url;
    const request = requestOf(entry, payload, origin);
    const resolved = resolve(`${prefixOf(origin)}${payload}`);
    const headers = new Headers(request.init.headers);
    headers.set("authorization", basic(key));
    const response = await fetch(request.url, { method: request.method, ...request.init, headers });
    const text = await response.text();
    const after = await tree();
    try {
      if (resolved.kind === "foreign" && entry !== "COPY" && entry !== "MOVE" && entry !== "If") {
        // Outside /dav the request reaches the Dashboard, which serves its page to any path; it is
        // not the WebDAV 404 of the in-process handler, and it never touches the files.
        expect(after).toEqual(before);
      } else {
        expect(expected(entry, resolved)).toContain(response.status);
      }
      // Nothing outside the scope is read: no content and no name of a file outside it.
      for (const content of OUTSIDE_CONTENT) expect(text).not.toContain(content);
      expect(text).not.toContain("secret.txt");
      // Nothing outside the scope changes.
      expect(outside(after)).toEqual(outside(before));
      if (response.status >= 400) expect(after).toEqual(before);
    } finally {
      if (JSON.stringify(after) !== JSON.stringify(before)) await restore(after);
    }
  });
});
