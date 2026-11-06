import { describe, expect, it } from "vitest";
import { countBy, distributionOf } from "./stats";
import { createJsonObjectSplitter, pollUntil } from "./tail";

describe("distributionOf", () => {
  it("has nothing to say about no samples", () => {
    expect(distributionOf([])).toBeNull();
  });

  it("uses the nearest rank", () => {
    const values = Array.from({ length: 100 }, (_, index) => 100 - index);

    expect(distributionOf(values)).toEqual({ count: 100, p50: 50, p90: 90, p99: 99, max: 100 });
  });

  it("handles a single sample", () => {
    expect(distributionOf([7])).toEqual({ count: 1, p50: 7, p90: 7, p99: 7, max: 7 });
  });
});

describe("countBy", () => {
  it("counts each key", () => {
    expect(countBy([200, 200, 503], String)).toEqual({ 200: 2, 503: 1 });
  });
});

const split = (...parts: string[]) => {
  const objects: unknown[] = [];
  const feed = createJsonObjectSplitter((text) => objects.push(JSON.parse(text)));
  parts.forEach(feed);
  return objects;
};

describe("createJsonObjectSplitter", () => {
  it("finds objects printed on one line or over several", () => {
    expect(split('{"a":1}\n{\n  "b": 2\n}\n')).toEqual([{ a: 1 }, { b: 2 }]);
  });

  it("joins an object that arrives in pieces", () => {
    expect(split('{"a":', '{"b":1}', "}")).toEqual([{ a: { b: 1 } }]);
  });

  it("is not confused by braces and quotes inside strings", () => {
    expect(split('{"a":"}{\\"}"}')).toEqual([{ a: '}{"}' }]);
  });

  it("ignores text between objects", () => {
    expect(split('Connected, waiting for logs...\n{"a":1}\ndone')).toEqual([{ a: 1 }]);
  });
});

// Hooks such as beforeAll cannot use expect.poll, so they poll with this instead.
describe("pollUntil", () => {
  it("stops as soon as the check passes", async () => {
    let calls = 0;
    const passed = await pollUntil(
      () => {
        calls += 1;
        return calls === 3;
      },
      { timeoutMs: 1000, intervalMs: 1 },
    );

    expect(passed).toBe(true);
    expect(calls).toBe(3);
  });

  it("gives up once the deadline passes", async () => {
    let calls = 0;
    const passed = await pollUntil(
      () => {
        calls += 1;
        return false;
      },
      { timeoutMs: 30, intervalMs: 5 },
    );

    expect(passed).toBe(false);
    expect(calls).toBeGreaterThan(1);
  });

  it("waits for an asynchronous check", async () => {
    const passed = await pollUntil(() => Promise.resolve(true), { timeoutMs: 0, intervalMs: 1 });

    expect(passed).toBe(true);
  });
});
