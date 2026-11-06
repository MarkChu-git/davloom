import { createHash, randomBytes } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PROBE_TOKEN_HEADER } from "../probe/token-guard";
import { startWorkerdServerWithDatabase, type Server } from "./servers";

const PROBE_CONFIG = "tests/integration/compat/probe/wrangler.jsonc";
const ADMIN = { email: "admin@davloom.test", password: "correct horse battery staple" };
const MEBIBYTE = 1024 * 1024;

const sha256 = (data: Uint8Array) => createHash("sha256").update(data).digest("hex");

describe("the Cloud Free route chain on local workerd", () => {
  let server: Server;
  let authorization: { authorization: string };

  const store = (path: string, init: RequestInit = {}) =>
    server.fetch(`/api/__probe/store${path}`, {
      ...init,
      headers: { ...authorization, ...init.headers },
    });

  const postJson = (path: string, body: unknown) =>
    store(path, {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json" },
    });

  beforeAll(async () => {
    server = await startWorkerdServerWithDatabase(PROBE_CONFIG);
    await server.fetch("/api/__probe/auth/setup", { method: "POST" });
    const response = await server.fetch("/api/__probe/auth/api-keys", { method: "POST" });
    const { key } = (await response.json()) as { key: string };
    authorization = { authorization: `Basic ${btoa(`client:${key}`)}` };
  });
  afterAll(() => server?.stop());

  it("refuses storage requests without a valid key", async () => {
    const response = await server.fetch("/api/__probe/store/files/secret.bin");

    expect(response.status).toBe(401);
  });

  it("stores a file as 1 MiB chunks and returns the same bytes", async () => {
    const content = randomBytes(3 * MEBIBYTE + 17);

    const written = await store("/files/round-trip.bin", { method: "PUT", body: content });
    const summary = (await written.json()) as { size: number; chunks: number };
    const read = await store("/files/round-trip.bin");

    expect(summary).toMatchObject({ size: content.byteLength, chunks: 4 });
    expect(sha256(new Uint8Array(await read.arrayBuffer()))).toBe(sha256(content));
  });

  it("keeps a percent-encoded file name", async () => {
    await store("/files/%E6%96%87%E4%BB%B6%20a.txt", { method: "PUT", body: "hello" });

    const read = await store("/files/%E6%96%87%E4%BB%B6%20a.txt");

    expect(await read.text()).toBe("hello");
  });

  it("answers 404 for a file that does not exist", async () => {
    const response = await store("/files/missing.bin");

    expect(response.status).toBe(404);
  });

  it("copies and deletes objects one by one within one request", async () => {
    await postJson("/directories/seed", { parent: "/churn/a", count: 10, bytes: 16 });

    const response = await postJson("/directories/churn", {
      from: "/churn/a",
      to: "/churn/b",
      count: 4,
    });
    const churn = (await response.json()) as { moved: number; rowsWritten: number };
    const source = await store("/directories?parent=%2Fchurn%2Fa");
    const target = await store("/directories?parent=%2Fchurn%2Fb");

    expect(churn.moved).toBe(4);
    expect(churn.rowsWritten).toBeGreaterThanOrEqual(4 * 4);
    expect(((await source.json()) as { children: unknown[] }).children).toHaveLength(6);
    expect(((await target.json()) as { children: unknown[] }).children).toHaveLength(4);
  });

  it("reports what an authenticated directory listing read and wrote", async () => {
    await postJson("/directories/seed", { parent: "/quota", count: 5, bytes: 16 });

    const response = await server.fetch("/api/__probe/quota/dav/quota", {
      method: "PROPFIND",
      headers: authorization,
    });
    const usage = (await response.json()) as {
      children: number;
      d1: { queries: number; rowsRead: number };
      durableObject: { rowsRead: number };
    };

    expect(usage.children).toBe(5);
    expect(usage.d1.queries).toBeGreaterThan(0);
    expect(usage.d1.rowsRead).toBeGreaterThan(0);
    expect(usage.durableObject.rowsRead).toBeGreaterThanOrEqual(5);
  });

  it("logs in with the correct password inside the object", async () => {
    const response = await server.fetch("/api/__probe/object/login", {
      method: "POST",
      body: JSON.stringify(ADMIN),
      headers: { "content-type": "application/json" },
    });

    expect(response.status).toBe(200);
    expect(response.headers.get("set-cookie")).toContain("session_token");
  });

  it.each(["/api/__probe/burn/1000", "/api/__probe/object/burn/1000"])(
    "%s spends CPU on request",
    async (path) => {
      const response = await server.fetch(path, { method: "POST" });

      expect(response.status).toBe(200);
    },
  );
});

describe("the token guard on local workerd", () => {
  const TOKEN = "token-for-this-test";
  let server: Server;

  beforeAll(async () => {
    server = await startWorkerdServerWithDatabase(PROBE_CONFIG, ["--var", `PROBE_TOKEN:${TOKEN}`]);
  });
  afterAll(() => server?.stop());

  it.each([
    ["no token", {}],
    ["the wrong token", { [PROBE_TOKEN_HEADER]: "wrong" }],
  ])("hides every route from a request with %s", async (_name, headers) => {
    const responses = await Promise.all(
      ["/api/health", "/api/__probe/auth/setup", "/dav/a.txt"].map((path) =>
        server.fetch(path, { headers }),
      ),
    );

    expect(responses.map((response) => response.status)).toEqual([404, 404, 404]);
  });

  it("answers a request with the token", async () => {
    const response = await server.fetch("/api/health", {
      headers: { [PROBE_TOKEN_HEADER]: TOKEN },
    });

    expect(response.status).toBe(200);
  });
});
