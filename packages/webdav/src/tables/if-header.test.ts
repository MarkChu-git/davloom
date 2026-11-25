import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import {
  CASES,
  evaluate,
  fillHeader,
  LENIENT,
  LOCK_BODY,
  statesOf,
  STATUS,
  statusOf,
} from "./if-header-cases";

// The If header (RFC 4918 §10.4): the table and oracle of if-header-cases.ts, against the handler.

const world = async () => {
  const w = setup();
  const a = await w.put("/a.txt", "a");
  const b = await w.put("/b.txt", "b");
  const lock = await w.dav("LOCK", "/a.txt", { headers: { depth: "0" }, body: LOCK_BODY });
  const token = (lock.headers.get("lock-token") ?? "").slice(1, -1);
  const etagA = (a.headers.get("etag") ?? "").slice(1, -1);
  const etagB = (b.headers.get("etag") ?? "").slice(1, -1);
  const states = statesOf({ token, etagA, etagB });
  const fill = (header: string) =>
    fillHeader(header, { root: `${ORIGIN}${BASE}`, token, etagA, etagB });
  return { w, token, states, fill };
};

describe("the If header", () => {
  it.each(CASES)("PUT %s with If: %s", async (target, template) => {
    const { w, token, states, fill } = await world();
    const header = fill(template);
    const status = statusOf(target, evaluate(header, target, states, token, `${ORIGIN}${BASE}`));
    const response = await w.put(target, "changed", { if: header });
    expect(response.status).toBe(status);
    const read = await w.dav("GET", target);
    expect(await read.text()).toBe(status === 204 ? "changed" : target.slice(1, 2));
  });

  it.each(LENIENT)("PUT /a.txt with the invalid If: %s is refused", async (template) => {
    const { w, fill } = await world();
    const response = await w.put("/a.txt", "changed", { if: fill(template) });
    expect([400, 412]).toContain(response.status);
    expect(await (await w.dav("GET", "/a.txt")).text()).toBe("a");
  });
});

// What the oracle answers for each header, written out (RFC 4918 §10.4): the PUT's target, the
// template and the status for a world where /a.txt holds the lock T and the tag A, and /b.txt the
// tag B and no lock. A change to a header or to the oracle that moves an answer fails here, not
// only in the comparison with the handler.
describe("the If header table, written out", () => {
  const root = "https://dav.example/dav";
  const fill = { root, token: "urn:uuid:7", etagA: "ta", etagB: "tb" };
  const states = statesOf(fill);
  const outcome = (target: string, template: string) =>
    evaluate(fillHeader(template, fill), target, states, fill.token, root);

  it("answers each header", () => {
    expect(
      CASES.map(([target, template]) => {
        const result = outcome(target, template);
        return `${target} ${template} -> ${result}, ${statusOf(target, result)}`;
      }),
    ).toMatchInlineSnapshot(`
      [
        "/a.txt (<@T>) -> true, token submitted, 204",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) -> false, 412",
        "/a.txt (Not <@T>) -> false, 412",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, no token, 423",
        "/a.txt (["@A"]) -> true, no token, 423",
        "/a.txt (["wrong"]) -> false, 412",
        "/a.txt (Not ["@A"]) -> false, 412",
        "/a.txt (Not ["wrong"]) -> true, no token, 423",
        "/a.txt (<DAV:no-lock>) -> false, 412",
        "/a.txt (Not <DAV:no-lock>) -> true, no token, 423",
        "/b.txt (<@T>) -> false, 412",
        "/b.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) -> false, 412",
        "/b.txt (Not <@T>) -> true, token submitted, 204",
        "/b.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, no token, 204",
        "/b.txt (["@B"]) -> true, no token, 204",
        "/b.txt (["wrong"]) -> false, 412",
        "/b.txt (Not ["@B"]) -> false, 412",
        "/b.txt (Not ["wrong"]) -> true, no token, 204",
        "/b.txt (<DAV:no-lock>) -> false, 412",
        "/b.txt (Not <DAV:no-lock>) -> true, no token, 204",
        "/a.txt (<@T> <urn:uuid:11111111-1111-4111-8111-111111111111>) -> false, 412",
        "/a.txt (<@T> Not <@T>) -> false, 412",
        "/a.txt (<@T> Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, token submitted, 204",
        "/a.txt (<@T> ["@A"]) -> true, token submitted, 204",
        "/a.txt (<@T> ["wrong"]) -> false, 412",
        "/a.txt (<@T> Not ["@A"]) -> false, 412",
        "/a.txt (<@T> Not ["wrong"]) -> true, token submitted, 204",
        "/a.txt (<@T> <DAV:no-lock>) -> false, 412",
        "/a.txt (<@T> Not <DAV:no-lock>) -> true, token submitted, 204",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> Not <@T>) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> ["@A"]) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> ["wrong"]) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> Not ["@A"]) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> Not ["wrong"]) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> <DAV:no-lock>) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111> Not <DAV:no-lock>) -> false, 412",
        "/a.txt (Not <@T> Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> false, 412",
        "/a.txt (Not <@T> ["@A"]) -> false, 412",
        "/a.txt (Not <@T> ["wrong"]) -> false, 412",
        "/a.txt (Not <@T> Not ["@A"]) -> false, 412",
        "/a.txt (Not <@T> Not ["wrong"]) -> false, 412",
        "/a.txt (Not <@T> <DAV:no-lock>) -> false, 412",
        "/a.txt (Not <@T> Not <DAV:no-lock>) -> false, 412",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111> ["@A"]) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111> ["wrong"]) -> false, 412",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111> Not ["@A"]) -> false, 412",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111> Not ["wrong"]) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111> <DAV:no-lock>) -> false, 412",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111> Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (["@A"] ["wrong"]) -> false, 412",
        "/a.txt (["@A"] Not ["@A"]) -> false, 412",
        "/a.txt (["@A"] Not ["wrong"]) -> true, no token, 423",
        "/a.txt (["@A"] <DAV:no-lock>) -> false, 412",
        "/a.txt (["@A"] Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (["wrong"] Not ["@A"]) -> false, 412",
        "/a.txt (["wrong"] Not ["wrong"]) -> false, 412",
        "/a.txt (["wrong"] <DAV:no-lock>) -> false, 412",
        "/a.txt (["wrong"] Not <DAV:no-lock>) -> false, 412",
        "/a.txt (Not ["@A"] Not ["wrong"]) -> false, 412",
        "/a.txt (Not ["@A"] <DAV:no-lock>) -> false, 412",
        "/a.txt (Not ["@A"] Not <DAV:no-lock>) -> false, 412",
        "/a.txt (Not ["wrong"] <DAV:no-lock>) -> false, 412",
        "/a.txt (Not ["wrong"] Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (<DAV:no-lock> Not <DAV:no-lock>) -> false, 412",
        "/a.txt (<@T>) (<urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, token submitted, 204",
        "/a.txt (<@T>) (Not <@T>) -> true, token submitted, 204",
        "/a.txt (<@T>) (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, token submitted, 204",
        "/a.txt (<@T>) (["@A"]) -> true, token submitted, 204",
        "/a.txt (<@T>) (["wrong"]) -> true, token submitted, 204",
        "/a.txt (<@T>) (Not ["@A"]) -> true, token submitted, 204",
        "/a.txt (<@T>) (Not ["wrong"]) -> true, token submitted, 204",
        "/a.txt (<@T>) (<DAV:no-lock>) -> true, token submitted, 204",
        "/a.txt (<@T>) (Not <DAV:no-lock>) -> true, token submitted, 204",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (Not <@T>) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, no token, 423",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (["@A"]) -> true, no token, 423",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (["wrong"]) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (Not ["@A"]) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (Not ["wrong"]) -> true, no token, 423",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (<DAV:no-lock>) -> false, 412",
        "/a.txt (<urn:uuid:11111111-1111-4111-8111-111111111111>) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (Not <@T>) (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) -> true, token submitted, 204",
        "/a.txt (Not <@T>) (["@A"]) -> true, token submitted, 204",
        "/a.txt (Not <@T>) (["wrong"]) -> false, 412",
        "/a.txt (Not <@T>) (Not ["@A"]) -> false, 412",
        "/a.txt (Not <@T>) (Not ["wrong"]) -> true, token submitted, 204",
        "/a.txt (Not <@T>) (<DAV:no-lock>) -> false, 412",
        "/a.txt (Not <@T>) (Not <DAV:no-lock>) -> true, token submitted, 204",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) (["@A"]) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) (["wrong"]) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) (Not ["@A"]) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) (Not ["wrong"]) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) (<DAV:no-lock>) -> true, no token, 423",
        "/a.txt (Not <urn:uuid:11111111-1111-4111-8111-111111111111>) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (["@A"]) (["wrong"]) -> true, no token, 423",
        "/a.txt (["@A"]) (Not ["@A"]) -> true, no token, 423",
        "/a.txt (["@A"]) (Not ["wrong"]) -> true, no token, 423",
        "/a.txt (["@A"]) (<DAV:no-lock>) -> true, no token, 423",
        "/a.txt (["@A"]) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (["wrong"]) (Not ["@A"]) -> false, 412",
        "/a.txt (["wrong"]) (Not ["wrong"]) -> true, no token, 423",
        "/a.txt (["wrong"]) (<DAV:no-lock>) -> false, 412",
        "/a.txt (["wrong"]) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (Not ["@A"]) (Not ["wrong"]) -> true, no token, 423",
        "/a.txt (Not ["@A"]) (<DAV:no-lock>) -> false, 412",
        "/a.txt (Not ["@A"]) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (Not ["wrong"]) (<DAV:no-lock>) -> true, no token, 423",
        "/a.txt (Not ["wrong"]) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt (<DAV:no-lock>) (Not <DAV:no-lock>) -> true, no token, 423",
        "/a.txt <@URL/a.txt> (<@T>) -> true, token submitted, 204",
        "/a.txt <@URL/a.txt> (["@A"]) -> true, no token, 423",
        "/a.txt <@URL/b.txt> (["@B"]) -> true, no token, 423",
        "/a.txt <@URL/b.txt> (["@B"]) <@URL/a.txt> (<@T>) -> true, token submitted, 204",
        "/a.txt <@URL/a.txt> (["wrong"]) <@URL/b.txt> (["@B"]) -> true, no token, 423",
        "/a.txt <@URL/b.txt> (<@T>) -> false, 412",
        "/a.txt <https://other.example/dav/a.txt> (<@T>) -> false, 412",
        "/a.txt <@PATH/a.txt> (<@T>) -> true, token submitted, 204",
        "/a.txt <@URL/a.txt> (<@T>) (["@A"]) -> true, token submitted, 204",
        "/a.txt <@URL/missing.txt> (Not ["wrong"]) -> true, no token, 423",
        "/b.txt <@URL/b.txt> (["@B"]) -> true, no token, 204",
        "/b.txt <@URL/a.txt> (["@A"]) -> true, no token, 204",
        "/a.txt (not <@T>) -> false, 412",
        "/a.txt (NOT <@T>) (<@T>) -> true, token submitted, 204",
        "/a.txt (<@T>)(["@A"]) -> true, token submitted, 204",
        "/a.txt    (<@T>)    -> true, token submitted, 204",
        "/a.txt (	<@T>	) -> true, token submitted, 204",
        "/a.txt (Not<@T>) (<@T>) -> true, token submitted, 204",
        "/a.txt <@T> -> malformed, 400",
        "/a.txt ( -> malformed, 400",
        "/a.txt () -> malformed, 400",
        "/a.txt (<@T> -> malformed, 400",
        "/a.txt ["@A"] -> malformed, 400",
        "/a.txt (Not) -> malformed, 400",
        "/a.txt (Nott <@T>) -> malformed, 400",
        "/a.txt (<@T>) <@URL/a.txt> (<@T>) -> malformed, 400",
        "/a.txt <@URL/a.txt> -> malformed, 400",
        "/a.txt <@URL/a.txt> <@URL/b.txt> (<@T>) -> malformed, 400",
        "/a.txt (<@T>) x -> malformed, 400",
        "/a.txt (<@T> [) -> malformed, 400",
        "/a.txt (["@A") -> malformed, 400",
        "/a.txt (<@T) -> malformed, 400",
        "/a.txt @T -> malformed, 400",
        "/a.txt (@T) -> malformed, 400",
      ]
    `);
  });

  it("reads the lenient headers as malformed", () => {
    expect(LENIENT.map((template) => outcome("/a.txt", template))).toEqual(
      LENIENT.map(() => "malformed"),
    );
    expect(LENIENT).toHaveLength(5);
  });

  it("fills a template and maps outcomes to statuses", () => {
    expect(fillHeader("<@URL/a.txt> <@PATH/b.txt> (<@T> [@A] [@B])", fill)).toBe(
      "<https://dav.example/dav/a.txt> </dav/b.txt> (<urn:uuid:7> [ta] [tb])",
    );
    expect(STATUS).toEqual({
      malformed: 400,
      false: 412,
      "true, token submitted": 204,
      "true, no token": 423,
    });
    expect(statusOf("/a.txt", "true, no token")).toBe(423);
    expect(statusOf("/b.txt", "true, no token")).toBe(204);
    expect(statusOf("/b.txt", "false")).toBe(412);
    expect(states["/missing.txt"]).toEqual({ locks: new Set(), etag: null });
    expect(LOCK_BODY).toBe(
      '<?xml version="1.0" encoding="utf-8"?><D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype></D:lockinfo>',
    );
  });
});
