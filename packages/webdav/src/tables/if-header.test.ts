import { describe, expect, it } from "vitest";
import { BASE, ORIGIN, setup } from "../test/harness";
import {
  CASES,
  evaluate,
  fillHeader,
  LENIENT,
  LOCK_BODY,
  statesOf,
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
