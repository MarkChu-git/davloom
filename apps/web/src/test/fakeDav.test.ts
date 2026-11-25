import { describe, expect, it } from "vitest";
import { FakeDav } from "./fakeDav";

// The in-memory WebDAV server the Files page's tests run against answers as RFC 4918 says a server
// answers, so a page that passes against it does not pass only because the fake is lenient.

const ORIGIN = "http://davloom.test";

const send = (dav: FakeDav, method: string, path: string, headers: Record<string, string> = {}) =>
  dav.handle(new Request(`${ORIGIN}/dav${path}`, { method, headers }));

const own = () => new Response("own");

const world = () =>
  new FakeDav()
    .folder("/")
    .folder("/files")
    .file("/files/a.txt", { body: "hello", contentType: "text/plain" })
    .folder("/files/docs")
    .file("/files/docs/b.txt", { body: "bee", sizeBytes: 9 });

describe("FakeDav", () => {
  it.each([
    ["PROPFIND", "/files/missing", {}, 404],
    ["PROPFIND", "/files/a.txt", {}, 404],
    ["GET", "/files/docs", {}, 404],
    ["GET", "/files/missing", {}, 404],
    ["MKCOL", "/files/docs", {}, 405],
    ["MKCOL", "/files/none/new", {}, 409],
    ["MKCOL", "/files/new", {}, 201],
    ["MOVE", "/files/missing", { destination: `${ORIGIN}/dav/files/x` }, 404],
    ["MOVE", "/files/a.txt", {}, 400],
    ["MOVE", "/files/a.txt", { destination: `${ORIGIN}/elsewhere/x` }, 400],
    ["COPY", "/files/a.txt", { destination: `${ORIGIN}/dav/files/none/x` }, 409],
    ["COPY", "/files/a.txt", { destination: `${ORIGIN}/dav/files/docs/b.txt` }, 412],
    ["DELETE", "/files/missing", {}, 404],
    ["LOCK", "/files/missing", {}, 404],
    ["UNLOCK", "/files/a.txt", { "lock-token": "<urn:uuid:none>" }, 409],
    ["PROPPATCH", "/files/a.txt", {}, 405],
  ])("answers %s %s %j with %i", async (method, path, headers, code) => {
    expect((await send(world(), method, path, headers)).status).toBe(code);
  });

  it("copies a folder with what it holds, its sizes too, and keeps the source", async () => {
    const dav = world();
    const answer = await send(dav, "COPY", "/files/docs", {
      destination: `${ORIGIN}/dav/files/copy`,
    });
    expect(answer.status).toBe(201);
    expect(dav.paths()).toContain("/files/copy/b.txt");
    expect(dav.paths()).toContain("/files/docs/b.txt");
    expect(dav.sizes.get("/files/copy/b.txt")).toBe(9);
  });

  it("deletes a folder with what it holds", async () => {
    const dav = world();
    expect((await send(dav, "DELETE", "/files/docs")).status).toBe(204);
    expect(dav.paths()).toEqual(["/", "/files", "/files/a.txt"]);
  });

  it("lists a folder with its locks, and the folder a Depth infinity lock is rooted at", async () => {
    const dav = world().lock("/files/docs", {
      depth: "infinity",
      seconds: null,
      showsToken: false,
    });
    const listed = await (await send(dav, "PROPFIND", "/files/docs")).text();
    expect(listed).toContain("<timeout>Infinite</timeout>");
    expect(listed).toContain("<lockroot><href>/dav/files/docs/</href></lockroot>");
    expect(listed).not.toContain("<locktoken>");
    expect(listed).toContain("<getcontentlength>9</getcontentlength>");
  });

  it("names a lock on a path it no longer holds as rooted at a file", async () => {
    const dav = world().lock("/files/gone", { depth: "infinity" });
    dav.folder("/files/gone/inner");
    const listed = await (await send(dav, "PROPFIND", "/files/gone/inner")).text();
    expect(listed).toContain("<lockroot><href>/dav/files/gone</href></lockroot>");
  });

  it("locks a file once, for the timeout asked or for ever, and unlocks it with its token", async () => {
    const dav = world();
    const locked = await send(dav, "LOCK", "/files/a.txt", { timeout: "Second-60", depth: "0" });
    expect(locked.status).toBe(200);
    expect(dav.locks.get("/files/a.txt")).toMatchObject({ seconds: 60, depth: "0" });
    expect((await send(dav, "LOCK", "/files/a.txt")).status).toBe(423);
    const token = locked.headers.get("lock-token") ?? "";
    expect((await send(dav, "UNLOCK", "/files/a.txt", { "lock-token": token })).status).toBe(204);
    const forever = await send(dav, "LOCK", "/files/docs");
    expect(forever.status).toBe(200);
    expect(dav.locks.get("/files/docs")).toMatchObject({ seconds: null, depth: "infinity" });
    expect(dav.lockRequests).toHaveLength(4);
  });

  it.each([
    ["into a missing folder", "/files/none/x", false, 409],
    ["over a folder", "/files/docs", false, 405],
    ["over a file, create only", "/files/a.txt", true, 412],
    ["over a file", "/files/a.txt", false, 201],
    ["a new file, create only", "/files/new.txt", true, 201],
  ])("answers a PUT %s with %i", async (_case, path, createOnly, code) => {
    const dav = world();
    expect(await dav.put(path, "x", "text/plain", createOnly)).toBe(code);
  });

  it("answers a refusal set for a request, for PUT too", async () => {
    const dav = world();
    dav.refusals.set("GET /files/a.txt", 503);
    dav.refusals.set("PUT /files/a.txt", 507);
    expect((await send(dav, "GET", "/files/a.txt")).status).toBe(503);
    expect(await dav.put("/files/a.txt", "x", "")).toBe(507);
  });

  it("holds a request until it is released", async () => {
    const dav = world();
    dav.held.add("GET /files/a.txt");
    const answer = send(dav, "GET", "/files/a.txt");
    await Promise.resolve();
    expect(dav.holding()).toBe(1);
    dav.release();
    expect(await (await answer).text()).toBe("hello");
    expect(dav.holding()).toBe(0);
  });

  it("answers what `rest` does not, below /dav only", () => {
    const dav = world();
    const api = dav.api({ "GET /api/me": own });
    expect(api["GET /api/me"]).toBe(own);
    expect(api["GET /dav/files"]).toBe(dav.handle);
    expect(api["GET /api/other"]).toBeUndefined();
    expect(Object.keys(new FakeDav().api())).toEqual([]);
  });
});
