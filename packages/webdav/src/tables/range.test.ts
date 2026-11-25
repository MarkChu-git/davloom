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

// The answer to each value of the table, written out (RFC 9110 §14.1.2, for the 100-byte /r.bin,
// the 1-byte /one and the empty /empty): the oracle has to give these, so a change to the table or
// to the oracle that moves an answer fails here, not only in the comparison with the handler.
const answer = (outcome: Outcome) =>
  outcome.status === 206 ? `206 ${outcome.first}-${outcome.last}` : String(outcome.status);

describe("Range answers, written out", () => {
  it("has a 100-byte representation of printable characters", () => {
    expect(CONTENT).toHaveLength(100);
    expect(CONTENT.slice(0, 12)).toBe("0123456789:;");
    expect(CONTENT.slice(74, 77)).toBe("z01");
    expect(Object.fromEntries(Object.entries(SIZES).map(([path, c]) => [path, c.length]))).toEqual({
      "/r.bin": 100,
      "/one": 1,
      "/empty": 0,
    });
  });

  it("answers the grid of int-ranges and suffix-ranges", () => {
    expect(
      Object.fromEntries(
        GRID.map(([path, value]) => [
          `${path} ${value}`,
          answer(oracle(value, (SIZES[path] ?? "").length)),
        ]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "/empty bytes=-0": "416",
        "/empty bytes=-1": "416",
        "/empty bytes=0-": "416",
        "/empty bytes=0-0": "416",
        "/empty bytes=5-10": "416",
        "/one bytes=-0": "416",
        "/one bytes=-1": "206 0-0",
        "/one bytes=-2": "206 0-0",
        "/one bytes=0-": "206 0-0",
        "/one bytes=0-0": "206 0-0",
        "/one bytes=0-1": "206 0-0",
        "/one bytes=1-": "416",
        "/one bytes=1-1": "416",
        "/one bytes=2-": "416",
        "/r.bin bytes=-0": "416",
        "/r.bin bytes=-1": "206 99-99",
        "/r.bin bytes=-100": "206 0-99",
        "/r.bin bytes=-10000": "206 0-99",
        "/r.bin bytes=-101": "206 0-99",
        "/r.bin bytes=-2": "206 98-99",
        "/r.bin bytes=-50": "206 50-99",
        "/r.bin bytes=-99": "206 1-99",
        "/r.bin bytes=0-": "206 0-99",
        "/r.bin bytes=0-0": "206 0-0",
        "/r.bin bytes=0-1": "206 0-1",
        "/r.bin bytes=0-100": "206 0-99",
        "/r.bin bytes=0-1000": "206 0-99",
        "/r.bin bytes=0-49": "206 0-49",
        "/r.bin bytes=0-98": "206 0-98",
        "/r.bin bytes=0-99": "206 0-99",
        "/r.bin bytes=1-": "206 1-99",
        "/r.bin bytes=1-0": "200",
        "/r.bin bytes=1-1": "206 1-1",
        "/r.bin bytes=1-100": "206 1-99",
        "/r.bin bytes=1-1000": "206 1-99",
        "/r.bin bytes=1-49": "206 1-49",
        "/r.bin bytes=1-98": "206 1-98",
        "/r.bin bytes=1-99": "206 1-99",
        "/r.bin bytes=100-": "416",
        "/r.bin bytes=100-0": "200",
        "/r.bin bytes=100-1": "200",
        "/r.bin bytes=100-100": "416",
        "/r.bin bytes=100-1000": "416",
        "/r.bin bytes=100-49": "200",
        "/r.bin bytes=100-98": "200",
        "/r.bin bytes=100-99": "200",
        "/r.bin bytes=1000-": "416",
        "/r.bin bytes=1000-0": "200",
        "/r.bin bytes=1000-1": "200",
        "/r.bin bytes=1000-100": "200",
        "/r.bin bytes=1000-1000": "416",
        "/r.bin bytes=1000-49": "200",
        "/r.bin bytes=1000-98": "200",
        "/r.bin bytes=1000-99": "200",
        "/r.bin bytes=101-": "416",
        "/r.bin bytes=101-0": "200",
        "/r.bin bytes=101-1": "200",
        "/r.bin bytes=101-100": "200",
        "/r.bin bytes=101-1000": "416",
        "/r.bin bytes=101-49": "200",
        "/r.bin bytes=101-98": "200",
        "/r.bin bytes=101-99": "200",
        "/r.bin bytes=49-": "206 49-99",
        "/r.bin bytes=49-0": "200",
        "/r.bin bytes=49-1": "200",
        "/r.bin bytes=49-100": "206 49-99",
        "/r.bin bytes=49-1000": "206 49-99",
        "/r.bin bytes=49-49": "206 49-49",
        "/r.bin bytes=49-98": "206 49-98",
        "/r.bin bytes=49-99": "206 49-99",
        "/r.bin bytes=98-": "206 98-99",
        "/r.bin bytes=98-0": "200",
        "/r.bin bytes=98-1": "200",
        "/r.bin bytes=98-100": "206 98-99",
        "/r.bin bytes=98-1000": "206 98-99",
        "/r.bin bytes=98-49": "200",
        "/r.bin bytes=98-98": "206 98-98",
        "/r.bin bytes=98-99": "206 98-99",
        "/r.bin bytes=99-": "206 99-99",
        "/r.bin bytes=99-0": "200",
        "/r.bin bytes=99-1": "200",
        "/r.bin bytes=99-100": "206 99-99",
        "/r.bin bytes=99-1000": "206 99-99",
        "/r.bin bytes=99-49": "200",
        "/r.bin bytes=99-98": "200",
        "/r.bin bytes=99-99": "206 99-99",
      }
    `);
  });

  it("answers the forms of the field", () => {
    expect(Object.fromEntries(FORMS.map((value) => [value, answer(oracle(value, CONTENT.length))])))
      .toMatchInlineSnapshot(`
      {
        "0-1": "200",
        "=0-1": "200",
        "@bytes=0-9": "200",
        "BYTES=10-19": "206 10-19",
        "Bytes=0-9": "206 0-9",
        "bits=0-9": "200",
        "bytes 0-1": "200",
        "bytes0-9": "200",
        "bytes:0-1": "200",
        "bytes=": "200",
        "bytes=+1-2": "200",
        "bytes=-": "200",
        "bytes=--1": "200",
        "bytes=-1,0-0": "200",
        "bytes=-1-2": "200",
        "bytes=-99999999999999999999999": "206 0-99",
        "bytes=0-0,0-0": "200",
        "bytes=0-1, 2-3": "200",
        "bytes=0-1,,5-6": "200",
        "bytes=0-1,2-3": "200",
        "bytes=0-1,a": "200",
        "bytes=0-99999999999999999999999": "206 0-99",
        "bytes=00000000000000000000000-00000000000000000000009": "206 0-9",
        "bytes=0x0-1": "200",
        "bytes=1-2-3": "200",
        "bytes=1-a": "200",
        "bytes=1.5-2": "200",
        "bytes=1e2-": "200",
        "bytes=200-300,400-500": "200",
        "bytes=99999999999999999999999-": "416",
        "bytes=a-b": "200",
        "bytes=­1": "200",
        "items=0-9": "200",
        "none": "200",
        "x bytes=0-9": "200",
      }
    `);
  });

  it("reads the lenient forms as their strict ones", () => {
    expect(
      // The strict reader of the oracle honors empty list elements and refuses spaces around "=".
      LENIENT.map(
        ([value, strict]) =>
          `${value} -> ${answer(oracle(value, CONTENT.length))}, as ${answer(oracle(strict, CONTENT.length))}`,
      ),
    ).toMatchInlineSnapshot(`
      [
        "bytes = 0-9 -> 200, as 206 0-9",
        "bytes=0 - 9 -> 200, as 206 0-9",
        "bytes=	0-9 -> 200, as 206 0-9",
        "bytes=0- 9 -> 200, as 206 0-9",
        "bytes=0-9, -> 206 0-9, as 206 0-9",
        "bytes=,0-9 -> 206 0-9, as 206 0-9",
        "bytes=0-9, , -> 206 0-9, as 206 0-9",
      ]
    `);
  });

  it("answers HEAD like GET", () => {
    expect(
      Object.fromEntries(
        HEAD_RANGES.map((value) => [value, answer(oracle(value, CONTENT.length))]),
      ),
    ).toMatchInlineSnapshot(`
      {
        "bytes=-0": "416",
        "bytes=0-1,3-4": "200",
        "bytes=0-9": "206 0-9",
        "bytes=100-": "416",
        "bytes=9-0": "200",
        "bytes=90-": "206 90-99",
      }
    `);
  });

  it("sends these If-Range values", () => {
    const modified = "Tue, 24 Nov 2026 12:00:00 GMT";
    expect(
      IF_RANGES.map(([label, value, applies]) => `${label}: ${value('"t1"', modified)} ${applies}`),
    ).toMatchInlineSnapshot(`
      [
        "the current strong tag: "t1" true",
        "another strong tag: "other" false",
        "the current tag made weak: W/"t1" false",
        "two tags: "t1", "other" false",
        "a malformed tag: t1" false",
        "a date before Last-Modified: Tue, 24 Nov 2026 11:59:59 GMT false",
        "a date after Last-Modified: Tue, 24 Nov 2026 12:00:01 GMT false",
        "a value that is no date: yesterday false",
      ]
    `);
  });
});
