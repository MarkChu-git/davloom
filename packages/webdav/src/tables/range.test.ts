import { beforeAll, describe, expect, it } from "vitest";
import { setup } from "../test/harness";
import {
  CONTENT,
  FORMS,
  GRID,
  HEAD_RANGES,
  IF_RANGES,
  LENIENT,
  oracle,
  SIZES,
  type Outcome,
} from "./range-cases";

// Range requests (RFC 9110 §14): the table and oracle of range-cases.ts, against the handler.

let world: ReturnType<typeof setup>;
let etag = "";
let lastModified = "";

beforeAll(async () => {
  world = setup();
  const put = await world.put("/r.bin", CONTENT);
  etag = put.headers.get("etag") ?? "";
  lastModified = put.headers.get("last-modified") ?? "";
  await world.put("/one", "x");
  await world.put("/empty", "");
});

const check = async (path: string, value: string, outcome: Outcome, method = "GET") => {
  const content = SIZES[path] ?? "";
  const response = await world.dav(method, path, { headers: { range: value } });
  const body = await response.text();
  expect(response.status).toBe(outcome.status);
  if (outcome.status === 206) {
    const part = content.slice(outcome.first, outcome.last + 1);
    expect(response.headers.get("content-range")).toBe(
      `bytes ${outcome.first}-${outcome.last}/${content.length}`,
    );
    expect(response.headers.get("content-length")).toBe(String(part.length));
    expect(body).toBe(method === "HEAD" ? "" : part);
  } else if (outcome.status === 416) {
    expect(response.headers.get("content-range")).toBe(`bytes */${content.length}`);
  } else {
    expect(response.headers.get("content-range")).toBeNull();
    expect(body).toBe(method === "HEAD" ? "" : content);
  }
};

describe("Range", () => {
  it.each(GRID)("GET %s with %s", async (path, value) => {
    await check(path, value, oracle(value, (SIZES[path] ?? "").length));
  });

  it.each(FORMS)("GET with Range %j", async (value) => {
    await check("/r.bin", value, oracle(value, CONTENT.length));
  });

  it.each(LENIENT)("GET with Range %j is ignored or read as %j", async (value, strict) => {
    const response = await world.dav("GET", "/r.bin", { headers: { range: value } });
    const body = await response.text();
    const honored = oracle(strict, CONTENT.length);
    expect(honored.status).toBe(206);
    if (response.status === 206 && honored.status === 206) {
      expect(body).toBe(CONTENT.slice(honored.first, honored.last + 1));
    } else {
      expect(response.status).toBe(200);
      expect(body).toBe(CONTENT);
    }
  });

  it.each(HEAD_RANGES)("HEAD with Range %j answers like GET, without a body", async (value) => {
    await check("/r.bin", value, oracle(value, CONTENT.length), "HEAD");
  });

  it.each(IF_RANGES)("If-Range with %s", async (_label, value, applies) => {
    const response = await world.dav("GET", "/r.bin", {
      headers: { range: "bytes=0-9", "if-range": value(etag, lastModified) },
    });
    const body = await response.text();
    expect(response.status).toBe(applies ? 206 : 200);
    expect(body).toBe(applies ? CONTENT.slice(0, 10) : CONTENT);
  });

  it("If-Range with the exact Last-Modified date applies the range or ignores it", async () => {
    // A date is a weak validator unless the server knows it is strong (§13.1.5): either is right.
    const response = await world.dav("GET", "/r.bin", {
      headers: { range: "bytes=0-9", "if-range": lastModified },
    });
    const body = await response.text();
    expect([206, 200]).toContain(response.status);
    expect(body).toBe(response.status === 206 ? CONTENT.slice(0, 10) : CONTENT);
  });
});
