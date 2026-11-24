import { migrate } from "@davloom/migrate";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDavloom, stringField, type Davloom } from "./davloom";

// Moving a Mount's files to another backend on a real Worker (PRD §7 Data Migration): copy them
// with the migration tool to a Mount of the new backend, point the Mount at that backend, and
// remove the helper Mount. Clients keep the same address and the same keys throughout.

let davloom: Davloom;
let other: Davloom;
beforeAll(async () => {
  [davloom, other] = await Promise.all([startDavloom(), startDavloom()]);
});
afterAll(async () => {
  await davloom?.server.stop();
  await other?.server.stop();
});

const BIG = new Uint8Array(2 * 1024 * 1024 + 5).map((_, i) => (i * 13) % 256);

const seed = async ({ dav }: Davloom) => {
  expect((await dav("/files/docs", { method: "MKCOL" })).status).toBe(201);
  expect((await dav("/files/docs/a.txt", { method: "PUT", body: "alpha" })).status).toBe(201);
  expect((await dav("/files/big.bin", { method: "PUT", body: BIG })).status).toBe(201);
  const tag = await dav("/files/docs/a.txt", {
    method: "PROPPATCH",
    body: '<?xml version="1.0"?><D:propertyupdate xmlns:D="DAV:" xmlns:Z="urn:z"><D:set><D:prop><Z:tag>kept</Z:tag></D:prop></D:set></D:propertyupdate>',
  });
  expect(tag.status).toBe(207);
};

const endpoint = (instance: Davloom, mount: string, key = instance.readWriteKey) => ({
  url: `${instance.server.url}/dav/${mount}/`,
  key,
});

describe("moving files", () => {
  it("moves a Mount to a new backend, and the Mount keeps its address and keys", async () => {
    await seed(davloom);
    const created = await davloom.api("/api/backends", {
      method: "POST",
      body: JSON.stringify({ name: "Second", kind: "durable-object" }),
    });
    expect(created.status).toBe(201);
    const backendId = stringField(await created.json(), "id");
    const helper = await davloom.api("/api/mounts", {
      method: "POST",
      body: JSON.stringify({ name: "incoming", backendId, root: "" }),
    });
    const helperId = stringField(await helper.json(), "id");

    const report = await migrate({
      source: endpoint(davloom, "files", davloom.readOnlyKey),
      target: endpoint(davloom, "incoming"),
    });
    expect(report).toMatchObject({ created: 1, written: 2, properties: 1, conflicts: [] });

    const mounts: unknown = await (await davloom.api("/api/mounts")).json();
    const files = Array.isArray(mounts)
      ? mounts.find((m: unknown) => stringField(m, "name") === "files")
      : undefined;
    const filesId = stringField(files, "id");
    const moved = await davloom.api(`/api/mounts/${filesId}`, {
      method: "PATCH",
      body: JSON.stringify({ backendId, root: "" }),
    });
    expect(moved.status).toBe(200);
    expect((await davloom.api(`/api/mounts/${helperId}`, { method: "DELETE" })).status).toBe(200);

    const read = await davloom.dav("/files/big.bin");
    expect(new Uint8Array(await read.arrayBuffer())).toEqual(BIG);
    const props = await davloom.dav("/files/docs/a.txt", {
      method: "PROPFIND",
      headers: { depth: "0" },
      body: '<?xml version="1.0"?><D:propfind xmlns:D="DAV:" xmlns:Z="urn:z"><D:prop><Z:tag/></D:prop></D:propfind>',
    });
    expect(await props.text()).toContain("kept");
    // The listing comes from the new backend now.
    expect(
      (
        await (await davloom.dav("/files/", { method: "PROPFIND", headers: { depth: "1" } })).text()
      ).match(/<D:href>/g)?.length,
    ).toBe(3);
  });

  it("copies a Mount to another instance, and a second run copies nothing", async () => {
    await other.dav("/files/x", { method: "MKCOL" });
    await other.dav("/files/x/y.txt", { method: "PUT", body: "why" });
    const first = await migrate({
      source: endpoint(other, "files"),
      target: endpoint(davloom, "files"),
    });
    expect(first).toMatchObject({ created: 1, written: 1, conflicts: [] });
    const second = await migrate({
      source: endpoint(other, "files"),
      target: endpoint(davloom, "files"),
    });
    expect(second).toMatchObject({ created: 0, written: 0, skipped: 2 });
    expect(await (await davloom.dav("/files/x/y.txt")).text()).toBe("why");
  });

  it("refuses a Mount target whose backend or root does not exist", async () => {
    const mounts: unknown = await (await davloom.api("/api/mounts")).json();
    const id = stringField(Array.isArray(mounts) ? mounts[0] : null, "id");
    for (const body of [
      { backendId: "nope", root: "" },
      { backendId: "", root: "../x" },
    ]) {
      const response = await davloom.api(`/api/mounts/${id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }
  });
});
