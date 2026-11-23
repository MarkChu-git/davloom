import { relationOf, scopeStorage, createMemoryStorage, type Path } from "@davloom/core";
import { authorizeScoped } from "@davloom/laws";
import { describe, expect, it } from "vitest";
import { createWebDavHandler } from "./handler";
import { createMemoryLockStore } from "./locks";
import { BASE, ORIGIN } from "./test/harness";

// A key limited to /files/photos, next to an unscoped key, on one namespace with one lock store.
const world = async () => {
  const storage = createMemoryStorage();
  for (const path of [["files"], ["files", "photos"]]) await storage.createCollection(path);
  await storage.write(["files", "secret.txt"], new Blob(["s"]).stream(), {});
  await storage.write(["files", "photos", "a.jpg"], new Blob(["a"]).stream(), {});
  await storage.patchProperties(
    ["files"],
    [{ name: "{urn:z}note", xml: '<note xmlns="urn:z">private</note>' }],
    [],
  );
  const locks = createMemoryLockStore();
  const scope: Path[] = [["files", "photos"]];
  const scoped = createWebDavHandler({
    basePath: BASE,
    storage: scopeStorage(storage, scope),
    locks,
    authorize: ({ method, target, destination }) =>
      authorizeScoped({
        access: "read-write",
        method,
        target: relationOf(target, scope),
        destination: destination === null ? "outside" : relationOf(destination, scope),
      }),
  });
  const admin = createWebDavHandler({ basePath: BASE, storage, locks });
  const call =
    (handler: typeof admin) =>
    (method: string, path: string, headers?: Record<string, string>, body?: string) =>
      handler(new Request(`${ORIGIN}${BASE}${path}`, { method, headers, body }));
  return { scoped: call(scoped), admin: call(admin), storage };
};

const lockBody =
  '<?xml version="1.0"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>';

describe("a scoped key and locks outside its scope", () => {
  it("cannot see the token of a lock rooted above its scope, nor unlock or refresh it", async () => {
    const { scoped, admin } = await world();
    const lock = await admin("LOCK", "/files", { depth: "infinity" }, lockBody);
    const token = lock.headers.get("lock-token") ?? "";
    const xml = await (await scoped("PROPFIND", "/files/photos", { depth: "0" })).text();
    expect(xml).toContain("<D:activelock>");
    expect(xml).not.toContain(token.slice(1, -1));
    expect((await scoped("UNLOCK", "/files/photos", { "lock-token": token })).status).toBe(403);
    expect((await scoped("LOCK", "/files/photos", { if: `(${token})` })).status).toBe(412);
    // The lock still protects the file outside the scope.
    expect((await admin("PUT", "/files/secret.txt", {}, "x")).status).toBe(423);
  });
});

const tagged = (tag: string) => ({ if: `<${ORIGIN}${BASE}/files/secret.txt> (["${tag}"])` });

describe("a scoped key and the If header", () => {
  it("learns nothing about a resource outside its scope from a tagged list", async () => {
    const { scoped, storage } = await world();
    const secret = await storage.stat(["files", "secret.txt"]);
    const etag = secret.ok ? secret.value.etag : "";
    const right = await scoped("PUT", "/files/photos/a.jpg", tagged(etag), "b");
    const wrong = await scoped("PUT", "/files/photos/a.jpg", tagged("nope"), "b");
    expect(right.status).toBe(412);
    expect(wrong.status).toBe(412);
  });
});

describe("a scoped key above its roots", () => {
  it("sees the folder that leads to its roots without its properties", async () => {
    const { scoped } = await world();
    const xml = await (await scoped("PROPFIND", "/files", { depth: "1" })).text();
    expect(xml).toContain("/dav/files/photos/");
    expect(xml).not.toContain("secret.txt");
    expect(xml).not.toContain("private");
  });
});
