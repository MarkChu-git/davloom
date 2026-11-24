import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT,
  expected as entityTagStatuses,
  ORDERS,
  TABLE as ENTITY_TAGS,
  type Resource,
  type Target as EntityTagTarget,
} from "../../../../packages/webdav/src/tables/entity-tags-cases";
import {
  CASES as IF_CASES,
  evaluate,
  fillHeader,
  LENIENT as IF_LENIENT,
  LOCK_BODY,
  statesOf,
  statusOf,
} from "../../../../packages/webdav/src/tables/if-header-cases";
import {
  headersOf,
  ifFor,
  LOCK_BODY as PROTECTION_LOCK_BODY,
  READS,
  statusOf as protectionStatusOf,
  TABLE as PROTECTIONS,
  WORLD as PROTECTION_WORLD,
  type Depth as ProtectionDepth,
} from "../../../../packages/webdav/src/tables/lock-protection-cases";
import {
  conflicts,
  covers,
  lockBody,
  TABLE as LOCK_CONFLICTS,
  WORLD as LOCK_WORLD,
  type Depth as LockDepth,
  type Scope as LockScope,
} from "../../../../packages/webdav/src/tables/lock-conflicts-cases";
import {
  allowOf,
  CLASS_2,
  OTHER_METHODS,
} from "../../../../packages/webdav/src/tables/methods-cases";
import {
  decodeHref,
  DISTINCT,
  NAMES,
  SAME,
  url,
} from "../../../../packages/webdav/src/tables/names-cases";
import {
  BODIES,
  findProperty,
  PROPERTIES,
  propfindOf,
  TABLE as PROPFIND_TABLE,
  type Get,
  type Kind,
} from "../../../../packages/webdav/src/tables/propfind-cases";
import {
  CONTENT,
  FORMS as RANGE_FORMS,
  GRID as RANGE_GRID,
  HEAD_RANGES,
  IF_RANGES,
  LENIENT as RANGE_LENIENT,
  oracle as rangeOracle,
  SIZES,
  type Outcome as RangeOutcome,
} from "../../../../packages/webdav/src/tables/range-cases";
import {
  DEPTHS,
  destinationsOf,
  OVERWRITES,
  readDepth,
  readOverwrite,
  TIMEOUTS,
  WORLD as HEADERS_WORLD,
} from "../../../../packages/webdav/src/tables/request-headers-cases";
import {
  destinationPath,
  rest,
  SOURCES,
  statusesOf,
  subtree,
  TABLE as TRANSFERS,
  WORLD as TRANSFER_WORLD,
} from "../../../../packages/webdav/src/tables/transfer-cases";
import {
  DOCUMENTS,
  EMPTY,
  EMPTY_BODIES,
  STATUS as XML_STATUS,
  TABLE as XML_BODIES,
} from "../../../../packages/webdav/src/tables/xml-bodies-cases";
import { hrefs } from "../../../../packages/webdav/src/test/harness";
import { startDavloom, type Davloom } from "./davloom";
import {
  build,
  exists,
  folderAt,
  newFolder,
  responsesOf,
  snapshot,
  TARGETS,
  type Folder,
} from "./tables";

// The protocol tables of packages/webdav/src/tables over HTTP, against each deployment: Range,
// If-Match and If-None-Match, the If header, Depth, Overwrite, Timeout and Destination, lock
// conflicts, what a lock protects, COPY and MOVE, Unicode names, PROPFIND's live properties, XML
// request bodies and the methods outside the protocol. (traversal.test.ts runs the traversal table;
// the permission table runs elsewhere.) Each table imports its cases and oracle
// from the module its in-process test uses. Where the in-process world is the namespace root, a
// folder of the `files` Mount stands in for it, built with real PUT and MKCOL requests; a case that
// changes its world gets a folder of its own. One server per target answers every table.

const withDepth = (depth: string | undefined, headers: Record<string, string> = {}) =>
  depth === undefined ? headers : { ...headers, depth };

const sorted = (list: readonly (string | undefined)[]) =>
  list.map((item) => item ?? "").toSorted((a, b) => a.localeCompare(b));

const lock = async (folder: Folder, path: string, scope: LockScope, depth: LockDepth) =>
  await folder.dav("LOCK", path, {
    headers: { depth, timeout: "Second-600" },
    body: lockBody(scope),
  });

describe.each(TARGETS)("the protocol tables on %s", (targetName, start, skip) => {
  const workers = targetName.startsWith("Workers");
  let davloom: Davloom | undefined;

  beforeAll(async () => {
    if (!skip) davloom = await startDavloom(start);
  }, 180_000);
  afterAll(async () => {
    await davloom?.server.stop();
  });

  const server = () => {
    if (!davloom) throw new Error("no server");
    return davloom;
  };
  /** A new folder with a tree built in it. */
  const world = async (table: string, tree: Readonly<Record<string, string>> = {}) => {
    const folder = await newFolder(server(), table);
    await build(folder, tree);
    return folder;
  };

  const runEntityTags = async (
    field: "if-match" | "if-none-match",
    value: string,
    target: EntityTagTarget,
  ) => {
    const folder = await world("etag");
    const put = await folder.put("/f.txt", "content");
    const opaque = (put.headers.get("etag") ?? "").slice(1, -1);
    const missing = target.endsWith("missing");
    const resource: Resource = missing ? { exists: false } : { exists: true, opaque };
    const header = value.replaceAll(CURRENT, opaque);
    const path = missing ? "/new.txt" : "/f.txt";
    const response = target.startsWith("GET")
      ? await folder.dav("GET", path, { headers: { [field]: header } })
      : await folder.dav("PUT", path, { body: "replaced", headers: { [field]: header } });
    const body = await response.text();
    const statuses = entityTagStatuses(field, header, target, resource);
    // workerd drops a field with an empty value before the Worker sees it, so an empty If-Match
    // may also get the answer to a request without one. Bun keeps it.
    const absent = {
      "GET existing": 200,
      "PUT existing": 204,
      "PUT missing": 201,
      "GET missing": 404,
    };
    expect(workers && header === "" ? [...statuses, absent[target]] : statuses).toContain(
      response.status,
    );
    // Only a request whose conditions hold changes the resource.
    const wrote = response.status === 201 || response.status === 204;
    if (missing) expect(await exists(folder, "/new.txt")).toBe(wrote);
    else
      expect(await (await folder.dav("GET", "/f.txt")).text()).toBe(wrote ? "replaced" : "content");
    if (response.status === 304) {
      expect(body).toBe("");
      expect(response.headers.get("etag")).toBe(`"${opaque}"`);
    }
  };

  /** If-header world: /a.txt and /b.txt, with an exclusive Depth 0 lock on /a.txt. */
  const ifWorld = async () => {
    const folder = await world("if");
    const a = await folder.put("/a.txt", "a");
    const b = await folder.put("/b.txt", "b");
    const held = await folder.dav("LOCK", "/a.txt", { headers: { depth: "0" }, body: LOCK_BODY });
    await held.body?.cancel();
    expect(held.status).toBe(200);
    const token = (held.headers.get("lock-token") ?? "").slice(1, -1);
    const etagA = (a.headers.get("etag") ?? "").slice(1, -1);
    const etagB = (b.headers.get("etag") ?? "").slice(1, -1);
    const root = `${folder.origin}${folder.base}`;
    return {
      folder,
      token,
      root,
      states: statesOf({ token, etagA, etagB }),
      fill: (header: string) => fillHeader(header, { root, token, etagA, etagB }),
    };
  };

  const headersWorld = () => world("headers", HEADERS_WORLD);

  const lockedWorld = async (depth: ProtectionDepth) => {
    const folder = await world("protect", PROTECTION_WORLD);
    const held = await folder.dav("LOCK", "/c", {
      headers: { depth },
      body: PROTECTION_LOCK_BODY,
    });
    await held.body?.cancel();
    expect(held.status).toBe(200);
    return { folder, token: (held.headers.get("lock-token") ?? "").slice(1, -1) };
  };

  describe.skipIf(skip)("Range", () => {
    let folder: Folder;
    let etag = "";
    let lastModified = "";

    beforeAll(async () => {
      folder = await world("range", { "/one": "x", "/empty": "" });
      const put = await folder.put("/r.bin", CONTENT);
      etag = put.headers.get("etag") ?? "";
      lastModified = put.headers.get("last-modified") ?? "";
    });

    const check = async (path: string, value: string, outcome: RangeOutcome, method = "GET") => {
      const content = SIZES[path] ?? "";
      const response = await folder.dav(method, path, { headers: { range: value } });
      const body = await response.text();
      expect(response.status).toBe(outcome.status);
      if (outcome.status === 206) {
        const part = content.slice(outcome.first, outcome.last + 1);
        expect(response.headers.get("content-range")).toBe(
          `bytes ${outcome.first}-${outcome.last}/${content.length}`,
        );
        // The handler sets Content-Length, but workerd sends a streamed body chunked and drops
        // the field; when one arrives, it must count the range's bytes.
        const length = response.headers.get("content-length");
        if (length !== null) expect(length).toBe(String(part.length));
        expect(body).toBe(method === "HEAD" ? "" : part);
      } else if (outcome.status === 416) {
        expect(response.headers.get("content-range")).toBe(`bytes */${content.length}`);
      } else {
        expect(response.headers.get("content-range")).toBeNull();
        expect(body).toBe(method === "HEAD" ? "" : content);
      }
    };

    it.each(RANGE_GRID)("GET %s with %s", async (path, value) => {
      await check(path, value, rangeOracle(value, (SIZES[path] ?? "").length));
    });

    it.each(RANGE_FORMS)("GET with Range %j", async (value) => {
      await check("/r.bin", value, rangeOracle(value, CONTENT.length));
    });

    it.each(RANGE_LENIENT)("GET with Range %j is ignored or read as %j", async (value, strict) => {
      const response = await folder.dav("GET", "/r.bin", { headers: { range: value } });
      const body = await response.text();
      const honored = rangeOracle(strict, CONTENT.length);
      expect(honored.status).toBe(206);
      if (response.status === 206 && honored.status === 206) {
        expect(body).toBe(CONTENT.slice(honored.first, honored.last + 1));
      } else {
        expect(response.status).toBe(200);
        expect(body).toBe(CONTENT);
      }
    });

    it.each(HEAD_RANGES)("HEAD with Range %j answers like GET, without a body", async (value) => {
      await check("/r.bin", value, rangeOracle(value, CONTENT.length), "HEAD");
    });

    it.each(IF_RANGES)("If-Range with %s", async (_label, value, applies) => {
      const response = await folder.dav("GET", "/r.bin", {
        headers: { range: "bytes=0-9", "if-range": value(etag, lastModified) },
      });
      const body = await response.text();
      expect(response.status).toBe(applies ? 206 : 200);
      expect(body).toBe(applies ? CONTENT.slice(0, 10) : CONTENT);
    });

    it("If-Range with the exact Last-Modified date applies the range or ignores it", async () => {
      const response = await folder.dav("GET", "/r.bin", {
        headers: { range: "bytes=0-9", "if-range": lastModified },
      });
      const body = await response.text();
      expect([206, 200]).toContain(response.status);
      expect(body).toBe(response.status === 206 ? CONTENT.slice(0, 10) : CONTENT);
    });
  });

  describe.skipIf(skip)("If-Match and If-None-Match", () => {
    it.each(ENTITY_TAGS)("%s on %s: %j", async (field, target, value) => {
      await runEntityTags(field, value, target);
    });

    it.each(["if-match", "if-none-match"] as const)(
      "%s on a missing resource for GET is 404",
      async (field) => {
        await runEntityTags(field, "*", "GET missing");
      },
    );

    it.each(ORDERS)("GET: %s", async (_label, headers, status) => {
      const folder = await world("etag");
      const put = await folder.put("/f.txt", "content");
      const tag = put.headers.get("etag") ?? "";
      const resolved = Object.fromEntries(
        Object.entries(headers).map(([name, value]) => [
          name,
          value.replaceAll(`"${CURRENT}"`, tag),
        ]),
      );
      const response = await folder.dav("GET", "/f.txt", { headers: resolved });
      await response.body?.cancel();
      expect(response.status).toBe(status);
    });
  });

  describe.skipIf(skip)("the If header", () => {
    it.each(IF_CASES)("PUT %s with If: %s", async (target, template) => {
      const { folder, token, root, states, fill } = await ifWorld();
      const header = fill(template);
      const status = statusOf(target, evaluate(header, target, states, token, root));
      const response = await folder.put(target, "changed", { if: header });
      expect(response.status).toBe(status);
      const read = await folder.dav("GET", target);
      expect(await read.text()).toBe(status === 204 ? "changed" : target.slice(1, 2));
    });

    it.each(IF_LENIENT)("PUT /a.txt with the invalid If: %s is refused", async (template) => {
      const { folder, fill } = await ifWorld();
      const response = await folder.put("/a.txt", "changed", { if: fill(template) });
      expect([400, 412]).toContain(response.status);
      expect(await (await folder.dav("GET", "/a.txt")).text()).toBe("a");
    });
  });

  describe.skipIf(skip)("Depth, Overwrite, Timeout and Destination", () => {
    it.each(DEPTHS)("PROPFIND of a collection with Depth %j", async (depth) => {
      const folder = await headersWorld();
      const response = await folder.dav("PROPFIND", "/c", { headers: withDepth(depth) });
      const body = await response.text();
      const parsed = readDepth(depth);
      if (parsed === "bad") return expect(response.status).toBe(400);
      if (parsed === null || parsed === "infinity") {
        expect(response.status).toBe(403);
        return expect(body).toContain("propfind-finite-depth");
      }
      expect(response.status).toBe(207);
      const base = folder.base;
      expect(sorted(hrefs(body))).toEqual(
        parsed === "0" ? [`${base}/c/`] : sorted([`${base}/c/`, `${base}/c/d/`, `${base}/c/x.txt`]),
      );
    });

    it.each(DEPTHS)("PROPFIND of a file with Depth %j", async (depth) => {
      const folder = await headersWorld();
      const response = await folder.dav("PROPFIND", "/f.txt", { headers: withDepth(depth) });
      const body = await response.text();
      if (readDepth(depth) === "bad") return expect(response.status).toBe(400);
      expect(response.status).toBe(207);
      expect(hrefs(body)).toEqual([`${folder.base}/f.txt`]);
    });

    it.each(DEPTHS)("DELETE of a collection with Depth %j", async (depth) => {
      const folder = await headersWorld();
      const response = await folder.dav("DELETE", "/c", { headers: withDepth(depth) });
      await response.body?.cancel();
      const parsed = readDepth(depth);
      const deletes = parsed === null || parsed === "infinity";
      expect(response.status).toBe(deletes ? 204 : 400);
      expect(await exists(folder, "/c/d/y.txt")).toBe(!deletes);
    });

    it.each(DEPTHS)("COPY of a collection with Depth %j", async (depth) => {
      const folder = await headersWorld();
      const response = await folder.dav("COPY", "/c", {
        headers: withDepth(depth, { destination: `${folder.origin}${folder.base}/copy` }),
      });
      await response.body?.cancel();
      const parsed = readDepth(depth);
      if (parsed === "bad" || parsed === "1") {
        expect(response.status).toBe(400);
        return expect(await exists(folder, "/copy")).toBe(false);
      }
      expect(response.status).toBe(201);
      expect(await exists(folder, "/copy")).toBe(true);
      expect(await exists(folder, "/copy/d/y.txt")).toBe(parsed !== "0");
    });

    it.each(DEPTHS)("MOVE of a collection with Depth %j", async (depth) => {
      const folder = await headersWorld();
      const response = await folder.dav("MOVE", "/c", {
        headers: withDepth(depth, { destination: `${folder.origin}${folder.base}/moved` }),
      });
      await response.body?.cancel();
      const parsed = readDepth(depth);
      const moves = parsed === null || parsed === "infinity";
      expect(response.status).toBe(moves ? 201 : 400);
      expect(await exists(folder, "/moved/d/y.txt")).toBe(moves);
      expect(await exists(folder, "/c")).toBe(!moves);
    });

    it.each(DEPTHS)("LOCK of a collection with Depth %j", async (depth) => {
      const folder = await headersWorld();
      const response = await folder.dav("LOCK", "/c", {
        headers: withDepth(depth),
        body: LOCK_BODY,
      });
      const body = await response.text();
      const parsed = readDepth(depth);
      if (parsed === "bad" || parsed === "1") return expect(response.status).toBe(400);
      expect(response.status).toBe(200);
      expect(body).toContain(`<D:depth>${parsed === "0" ? "0" : "infinity"}</D:depth>`);
      // An infinite lock covers the members; a Depth 0 lock does not.
      const put = await folder.put("/c/x.txt", "changed");
      expect(put.status).toBe(parsed === "0" ? 204 : 423);
    });

    it.each(
      (["COPY", "MOVE"] as const).flatMap((method) =>
        [true, false].flatMap((there) =>
          OVERWRITES.map((value) => [method, there, value] as const),
        ),
      ),
    )("%s onto a destination that exists: %s, Overwrite %j", async (method, there, value) => {
      const folder = await headersWorld();
      const destination = there ? "/g.txt" : "/h.txt";
      const response = await folder.dav(method, "/f.txt", {
        headers: {
          destination: `${folder.origin}${folder.base}${destination}`,
          ...(value === undefined ? {} : { overwrite: value }),
        },
      });
      await response.body?.cancel();
      const overwrite = readOverwrite(value);
      // §9.8.5 and §9.9.4: 412 when the destination exists and Overwrite is F; 204 when it was
      // replaced; 201 when it was created.
      const status = overwrite === "bad" ? 400 : !there ? 201 : overwrite ? 204 : 412;
      expect(response.status).toBe(status);
      const done = status === 201 || status === 204;
      const read = await folder.dav("GET", destination);
      const text = await read.text();
      if (done || there) expect(text).toBe(done ? "f-content" : "g-content");
      else expect(read.status).toBe(404);
      expect(await exists(folder, "/f.txt")).toBe(!(method === "MOVE" && done));
    });

    it.each(TIMEOUTS)("LOCK with Timeout %j", async (value, requested) => {
      const folder = await headersWorld();
      const response = await folder.dav("LOCK", "/f.txt", {
        headers: { depth: "0", ...(value === undefined ? {} : { timeout: value }) },
        body: LOCK_BODY,
      });
      const body = await response.text();
      expect(response.status).toBe(200);
      const granted = Number(/<D:timeout>Second-(\d+)<\/D:timeout>/.exec(body)?.[1]);
      expect(granted).toBeGreaterThanOrEqual(1);
      // Both deployments run the handler with its default longest lock of 3600 seconds.
      expect(granted).toBeLessThanOrEqual(
        Math.min(3600, requested === null || requested === 0 ? 3600 : requested),
      );
    });

    // The rows depend on the server's origin and the folder, which exist only once the server
    // runs; their labels do not, so the table is built from a stand-in and read again per case.
    const STAND_IN = { origin: "http://127.0.0.1:1", namespace: "/dav", root: "/dav/files/x" };
    it.each(
      (["COPY", "MOVE"] as const).flatMap((method) =>
        destinationsOf(STAND_IN).map(([label], index) => [method, label, index] as const),
      ),
    )("%s to %s", async (method, _label, index) => {
      const folder = await headersWorld();
      const row = destinationsOf({
        origin: folder.origin,
        namespace: "/dav",
        root: folder.base,
      })[index];
      if (!row) throw new Error(`no destination ${index}`);
      const [, value, statuses, created] = row;
      const response = await folder.dav(method, "/f.txt", {
        headers: value === undefined ? {} : { destination: value },
      });
      await response.body?.cancel();
      expect(statuses).toContain(response.status);
      const done = response.status === 201 || response.status === 204;
      if (created !== null && done) {
        const read = await folder.dav("GET", `/${encodeURIComponent(created)}`);
        expect(await read.text()).toBe("f-content");
      }
      expect(await exists(folder, "/f.txt")).toBe(!(method === "MOVE" && done));
      if (!done) expect(await (await folder.dav("GET", "/g.txt")).text()).toBe("g-content");
    });
  });

  describe.skipIf(skip)("lock conflicts", () => {
    it.each(LOCK_CONFLICTS)(
      "a %s %s lock (Depth %s) then a %s %s lock (Depth %s)",
      async (held, heldScope, heldDepth, wanted, wantedScope, wantedDepth) => {
        const folder = await world("locks", LOCK_WORLD);
        const first = await lock(folder, held, heldScope, heldDepth);
        await first.body?.cancel();
        expect(first.status).toBe(200);
        const second = await lock(folder, wanted, wantedScope, wantedDepth);
        const body = await second.text();
        const conflict = conflicts(
          { root: held, scope: heldScope, depth: heldDepth },
          { root: wanted, scope: wantedScope, depth: wantedDepth },
        );
        expect(second.status).toBe(conflict ? 423 : 200);
        if (conflict) {
          expect(body).toContain("no-conflicting-lock");
          expect(second.headers.get("lock-token")).toBeNull();
        } else {
          expect(second.headers.get("lock-token")).toMatch(/^<urn:uuid:[0-9a-f-]{36}>$/);
          expect(second.headers.get("lock-token")).not.toBe(first.headers.get("lock-token"));
        }
        // PROPFIND shows every lock that covers the wanted resource, and only those.
        const discovery = await folder.dav("PROPFIND", wanted, {
          headers: { depth: "0" },
          body: '<D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>',
        });
        const xml = await discovery.text();
        const shown = (xml.match(/<D:activelock>/g) ?? []).length;
        expect(shown).toBe((covers(held, heldDepth, wanted) ? 1 : 0) + (conflict ? 0 : 1));
      },
    );
  });

  describe.skipIf(skip)("Unicode names", () => {
    it.each(NAMES)("a file named with %s round-trips through PUT and GET", async (_label, name) => {
      const folder = await world("names");
      expect((await folder.put(url(name), `content of ${name}`)).status).toBe(201);
      const response = await folder.dav("GET", url(name));
      expect(response.status).toBe(200);
      expect(await response.text()).toBe(`content of ${name}`);
    });

    it.each(NAMES)(
      "PROPFIND lists a collection named with %s by an href that decodes to it",
      async (_label, name) => {
        const folder = await world("names");
        expect((await folder.mkcol(url(name))).status).toBe(201);
        expect((await folder.put(`${url(name)}/inner.txt`, "x")).status).toBe(201);
        const response = await folder.dav("PROPFIND", "/", { headers: { depth: "1" } });
        const listed = hrefs(await response.text()).map((href = "") => href);
        const member = listed.filter((href) => href !== `${folder.base}/`);
        expect(member).toHaveLength(1);
        expect(member[0]?.endsWith("/")).toBe(true);
        expect(decodeHref((member[0] ?? "").slice(folder.base.length + 1, -1))).toBe(name);
      },
    );

    it.each(NAMES)(
      "a collection named with %s is deleted by its encoded URL",
      async (_label, name) => {
        const folder = await world("names");
        await folder.mkcol(url(name));
        await folder.put(`${url(name)}/inner.txt`, "x");
        const response = await folder.dav("DELETE", url(name));
        await response.body?.cancel();
        expect(response.status).toBe(204);
        expect(await exists(folder, url(name))).toBe(false);
      },
    );

    it.each(DISTINCT)("%j and %j are two files", async (first, second) => {
      const folder = await world("names");
      await folder.put(url(first), "first");
      await folder.put(url(second), "second");
      expect(await (await folder.dav("GET", url(first))).text()).toBe("first");
      expect(await (await folder.dav("GET", url(second))).text()).toBe("second");
    });

    it.each(SAME)("%s and %s name the same file", async (sent, other) => {
      const folder = await world("names");
      await folder.put(`/${sent}`, "one");
      expect(await (await folder.dav("GET", `/${other}`)).text()).toBe("one");
    });
  });

  describe.skipIf(skip)("PROPFIND live properties", () => {
    // The in-process world's root and `files` Mount root are the deployment's own; its
    // collection and file are a folder of the Mount and a file in it.
    const paths: Record<Kind, string> = {
      file: "",
      collection: "",
      root: "/",
      "mount root": "/files",
    };
    let dav: Folder;
    let get: Get;

    beforeAll(async () => {
      const folder = await world("propfind", { "/a.jpg": "photo-a-content" });
      dav = folderAt(server(), "/dav");
      paths.collection = folder.base.slice("/dav".length);
      paths.file = `${paths.collection}/a.jpg`;
      const head = await dav.dav("HEAD", paths.file);
      const read = await dav.dav("GET", paths.file);
      get = {
        etag: head.headers.get("etag"),
        lastModified: head.headers.get("last-modified"),
        // workerd drops a streamed body's Content-Length (see Range), so the length is the body's.
        length: String((await read.arrayBuffer()).byteLength),
        type: head.headers.get("content-type"),
      };
    });

    const propfind = async (path: string, body: string) => {
      const response = await dav.dav("PROPFIND", path, {
        headers: { depth: "0" },
        body: propfindOf(body),
      });
      expect(response.status).toBe(207);
      return await response.text();
    };

    it.each(PROPFIND_TABLE)("%s on the %s with %s", async (name, kind, form) => {
      const property = PROPERTIES[name];
      if (!property) throw new Error(name);
      const rule = property.rules[kind];
      const found = findProperty(await propfind(paths[kind], BODIES[form](name)), name);
      expect(found.length).toBeLessThanOrEqual(1);
      const [hit] = found;
      const present = hit?.status === 200;
      if (present) {
        expect(rule).not.toBe("absent");
        if (form === "propname") expect(hit.value).toBe("");
        else expect(property.valid(hit.value, kind, get)).toBe(true);
      } else {
        expect(rule).not.toBe("required");
      }
      if (form === "prop") {
        expect(hit?.status === 200 || hit?.status === 404).toBe(true);
      } else if (form === "propname" || form === "allprop") {
        expect(hit === undefined || present).toBe(true);
        if (!property.allprop && form === "allprop") expect(hit).toBeUndefined();
      } else {
        const asked = findProperty(await propfind(paths[kind], BODIES.prop(name)), name);
        if (asked[0]?.status === 200) expect(present).toBe(true);
        else if (!property.allprop) expect(present).toBe(false);
      }
    });
  });

  describe.skipIf(skip)("what a write lock on /c protects", () => {
    // Every case's world is built alike and its snapshot holds no entity tags, so one snapshot
    // of a world as built stands for each case's before.
    let before: Record<string, string> = {};
    beforeAll(async () => {
      before = await snapshot(await world("protect", PROTECTION_WORLD));
    });

    it.each(PROTECTIONS)(
      "%s under a Depth %s lock with %s",
      async (_label, depth, token, operation) => {
        const { folder, token: lockToken } = await lockedWorld(depth);
        const root = `${folder.origin}${folder.base}`;
        const response = await folder.dav(operation.method, operation.path, {
          headers: { ...headersOf(operation, root), ...ifFor(token, lockToken, root) },
          body: operation.body,
        });
        const text = await response.text();
        const status = protectionStatusOf(operation, depth, token);
        expect(response.status).toBe(status);
        if (status === 423) expect(text).toContain("lock-token-submitted");
        if (status >= 400) expect(await snapshot(folder)).toEqual(before);
      },
    );

    it.each(READS)(
      "%s under a Depth %s lock",
      async (_label, depth, method, path, headers, statuses) => {
        const { folder, token } = await lockedWorld(depth);
        const filled = Object.fromEntries(
          Object.entries(headers).map(([name, value]) => [name, value.replace("@T", token)]),
        );
        const response = await folder.dav(method, path, { headers: filled });
        await response.body?.cancel();
        expect(response.status).toBe(statuses[depth === "0" ? 0 : 1]);
        // An UNLOCK that succeeded removed the lock: the collection takes a member without a token.
        if (method === "UNLOCK") {
          expect((await folder.put("/c/after.txt", "x")).status).toBe(
            response.status === 204 ? 201 : 423,
          );
        }
      },
    );
  });

  describe.skipIf(skip)("COPY and MOVE", () => {
    // As for the lock table, one snapshot of a world as built stands for each case's before.
    let before: Record<string, string> = {};
    beforeAll(async () => {
      before = await snapshot(await world("transfer", TRANSFER_WORLD));
    });

    it.each(TRANSFERS)(
      "%s of %s onto %s, Overwrite %s",
      async (method, source, destination, overwrite) => {
        const folder = await world("transfer", TRANSFER_WORLD);
        const from = SOURCES[source];
        const to = destinationPath(destination, from);
        const response = await folder.dav(method, from, {
          headers: {
            destination: `${folder.origin}${folder.base}${to}`,
            overwrite: overwrite ? "T" : "F",
          },
        });
        await response.body?.cancel();
        expect(statusesOf(source, destination, overwrite)).toContain(response.status);
        const after = await snapshot(folder);
        if (response.status >= 400) return expect(after).toEqual(before);
        // The destination is exactly the source's tree; nothing of what it replaced remains.
        expect(subtree(after, to)).toEqual(subtree(before, from));
        if (method === "COPY") expect(subtree(after, from)).toEqual(subtree(before, from));
        else expect(subtree(after, from)).toEqual({});
        expect(rest(after, from, to)).toEqual(rest(before, from, to));
      },
    );
  });

  describe.skipIf(skip)("XML request bodies", () => {
    const STATE =
      '<?xml version="1.0" encoding="utf-8"?><D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/><Z:note xmlns:Z="urn:z"/></D:prop></D:propfind>';

    it.each(XML_BODIES)("%s with %s", async (method, _label, body) => {
      const folder = await world("xml", { "/a.jpg": "photo-a-content" });
      const text = body.build(DOCUMENTS[method], method);
      const response = await folder.dav(method, "/a.jpg", {
        headers: { depth: "0", "content-type": "application/xml" },
        body: text,
      });
      const reply = await response.text();
      const valid = body.verdict === "valid";
      expect(valid ? [DOCUMENTS[method].success] : XML_STATUS[body.verdict]).toContain(
        response.status,
      );
      const state = await folder.dav("PROPFIND", "/a.jpg", {
        headers: { depth: "0", "content-type": "application/xml" },
        body: STATE,
      });
      const [entry] = responsesOf(await state.text());
      const stored = (entry?.found ?? []).filter((prop) => prop.ns === "urn:z");
      const locks = (entry?.found ?? [])
        .filter((prop) => prop.local === "lockdiscovery")
        .flatMap((prop) => prop.children)
        .filter((child) => typeof child !== "string" && child.local === "activelock");
      // Only a valid PROPPATCH stores the property, and only a valid LOCK takes a lock.
      expect(stored.map((prop) => `{${prop.ns}}${prop.local}`)).toEqual(
        valid && method === "PROPPATCH" ? ["{urn:z}note"] : [],
      );
      expect(locks.length).toBe(valid && method === "LOCK" ? 1 : 0);
      // Nothing from a declaration ever comes back.
      expect(reply).not.toContain("boom");
      expect(reply).not.toContain("lollol");
    });

    it.each(
      EMPTY.flatMap(([method, status]) =>
        EMPTY_BODIES.map((body) => [method, status, body] as const),
      ),
    )("%s with the empty body %j answers %i", async (method, status, body) => {
      const folder = await world("xml", { "/a.jpg": "photo-a-content" });
      const response = await folder.dav(method, "/a.jpg", { headers: { depth: "0" }, body });
      await response.body?.cancel();
      expect(response.status).toBe(status);
    });
  });

  describe.skipIf(skip)("methods outside the protocol", () => {
    let folder: Folder;
    beforeAll(async () => {
      folder = await world("methods", { "/a.jpg": "photo-a-content" });
    });

    it.each(OTHER_METHODS)(
      "%s with a Read / Write key is refused by the policy",
      async (method) => {
        const response = await folder.dav(method, "/a.jpg");
        await response.body?.cancel();
        // workerd's HTTP server answers 501 itself to a method it does not know (BIND, LINK,
        // MKCALENDAR and others), so those never reach the Worker; Bun passes every one on.
        expect(workers ? [403, 501] : [403]).toContain(response.status);
        expect(await (await folder.dav("GET", "/a.jpg")).text()).toBe("photo-a-content");
      },
    );

    it.each(["/", "/missing", "/x/y/z"])("OPTIONS %s advertises DAV 1, 2", async (path) => {
      const response = await folderAt(server(), "/dav").dav("OPTIONS", path);
      await response.body?.cancel();
      expect(response.status).toBe(200);
      expect(response.headers.get("dav")).toBe("1, 2");
      expect(allowOf(response)).toEqual(CLASS_2.toSorted());
    });
  });
});
