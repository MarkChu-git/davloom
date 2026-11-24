import { describe, expect, it } from "vitest";
import { setup } from "../test/harness";
import { CURRENT, expected, ORDERS, TABLE, type Resource, type Target } from "./entity-tags-cases";

// If-Match and If-None-Match (RFC 9110 §13.1.1, §13.1.2, §13.2.2): the table and oracle of
// entity-tags-cases.ts, against the handler.

const run = async (field: "if-match" | "if-none-match", value: string, target: Target) => {
  const world = setup();
  const put = await world.put("/f.txt", "content");
  const opaque = (put.headers.get("etag") ?? "").slice(1, -1);
  const missing = target.endsWith("missing");
  const resource: Resource = missing ? { exists: false } : { exists: true, opaque };
  const header = value.replaceAll(CURRENT, opaque);
  const path = missing ? "/new.txt" : "/f.txt";
  const response = target.startsWith("GET")
    ? await world.dav("GET", path, { headers: { [field]: header } })
    : await world.put(path, "replaced", { [field]: header });
  const body = await response.text();
  const statuses = expected(field, header, target, resource);
  expect(statuses).toContain(response.status);
  // Only a request whose conditions hold changes the resource.
  const after = await world.storage.stat(missing ? ["new.txt"] : ["f.txt"]);
  const wrote = response.status === 201 || response.status === 204;
  if (missing) expect(after.ok).toBe(wrote);
  else expect(after.ok && after.value.etag !== opaque).toBe(wrote);
  if (response.status === 304) {
    expect(body).toBe("");
    expect(response.headers.get("etag")).toBe(`"${opaque}"`);
  }
};

describe("If-Match and If-None-Match", () => {
  it.each(TABLE)("%s on %s: %j", async (field, target, value) => {
    await run(field, value, target);
  });

  it.each(["if-match", "if-none-match"] as const)(
    "%s on a missing resource for GET is 404",
    async (field) => {
      await run(field, "*", "GET missing");
    },
  );

  it.each(ORDERS)("GET: %s", async (_label, headers, status) => {
    const world = setup();
    const put = await world.put("/f.txt", "content");
    const tag = put.headers.get("etag") ?? "";
    const resolved = Object.fromEntries(
      Object.entries(headers).map(([name, value]) => [name, value.replaceAll(`"${CURRENT}"`, tag)]),
    );
    const response = await world.dav("GET", "/f.txt", { headers: resolved });
    await response.body?.cancel();
    expect(response.status).toBe(status);
  });
});
