import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { backendDetail } from "./backendDetail";

describe("backendDetail", () => {
  it.each([
    [{ available: true, status: { state: "answered", ms: 38 } }, "answered in 38 ms"],
    [{ available: true, status: { state: "answered", ms: 999.4 } }, "answered in 999 ms"],
    [{ available: true, status: { state: "answered", ms: 1250 } }, "answered in 1.3 s"],
    [
      { available: false, status: { state: "failed", failure: "unavailable", ms: 30_000 } },
      "gave no answer after 30 s",
    ],
    [
      { available: false, status: { state: "failed", failure: "insufficient-storage", ms: 5 } },
      "gave a full store after 5 ms",
    ],
    [
      { available: false, status: { state: "failed", failure: "hidden-objects", ms: 5 } },
      "gave hidden-objects after 5 ms",
    ],
    [
      { available: false, status: { state: "not-opened" } },
      "cannot be opened with its saved settings",
    ],
    [{ available: true }, "answered"],
    [{ available: false }, "gave no answer"],
  ] as const)("%j reads %s", (backend, text) => {
    expect(backendDetail(backend)).toBe(text);
  });

  it("names a time in milliseconds below a second and in seconds from one", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600_000 }), (ms) => {
        const text = backendDetail({ available: true, status: { state: "answered", ms } });
        expect(text.endsWith(ms < 1000 ? " ms" : " s")).toBe(true);
      }),
    );
  });
});
