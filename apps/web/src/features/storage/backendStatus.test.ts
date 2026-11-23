import { describe, expect, it } from "vitest";
import { backendStatus, storageAlert } from "./backendStatus";

describe("backend status", () => {
  it("an answering backend is Available, and one that does not answer is Unavailable", () => {
    expect(backendStatus({ available: true })).toEqual({ tone: "success", label: "Available" });
    expect(backendStatus({ available: false })).toEqual({ tone: "error", label: "Unavailable" });
  });

  it.each([
    [undefined, undefined],
    [[], undefined],
    [[{ available: true }], undefined],
    [[{ available: false }, { available: true }], "1 backend unavailable"],
    [[{ available: false }, { available: false }], "2 backends unavailable"],
  ])("%j alerts %j", (backends, text) => {
    expect(storageAlert(backends)?.text).toBe(text);
  });
});
