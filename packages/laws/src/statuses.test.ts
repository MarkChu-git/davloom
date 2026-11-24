import { describe, expect, it } from "vitest";
import { FAILURE_NAMES, failureStatus, type FailureName } from "./statuses";

// RFC 9110 §15 and RFC 4918 §9, transcribed independently of the Bend module.
const EXPECTED: Record<FailureName, number> = {
  "not-found": 404,
  "no-parent": 409,
  exists: 405,
  "is-collection": 405,
  "not-collection": 409,
  "into-itself": 403,
  root: 403,
  "insufficient-storage": 507,
  "too-large": 413,
  "size-mismatch": 400,
  unavailable: 503,
  "name-refused": 403,
  "name-refused-replaced": 403,
  "hidden-objects": 409,
  "cross-backend": 502,
  "too-many": 403,
};
const SERVER: ReadonlySet<FailureName> = new Set([
  "insufficient-storage",
  "unavailable",
  "cross-backend",
]);

describe("failure statuses", () => {
  it.each(FAILURE_NAMES)("%s answers its status", (failure) => {
    expect(failureStatus(failure)).toBe(EXPECTED[failure]);
  });

  it.each(FAILURE_NAMES)("%s is an error, 5xx exactly when it is the server's", (failure) => {
    const status = failureStatus(failure);
    expect(status).toBeGreaterThanOrEqual(400);
    expect(status).toBeLessThan(600);
    expect(status >= 500).toBe(SERVER.has(failure));
  });

  it("names every failure once", () => {
    expect(new Set(FAILURE_NAMES).size).toBe(16);
    expect([...FAILURE_NAMES].toSorted()).toEqual(Object.keys(EXPECTED).toSorted());
  });
});
