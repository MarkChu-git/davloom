import { describe, expect, it } from "vitest";
import { evaluatePreconditions, type Check, type Conditions, type Verdict } from "./preconditions";

// RFC 9110 §13.2.2, steps 1 to 5, transcribed as written.
const oracle = (c: Conditions): Verdict => {
  // Step 1
  if (c.ifMatch !== "unset") {
    if (c.ifMatch === "fails") return "failed";
  } else if (c.ifUnmodifiedSince !== "unset") {
    // Step 2
    if (c.ifUnmodifiedSince === "fails") return "failed";
  }
  // Step 3
  if (c.ifNoneMatch !== "unset") {
    if (c.ifNoneMatch === "holds") return c.read ? "not-modified" : "failed";
    return "pass";
  }
  // Step 4
  if (c.read && c.ifModifiedSince === "fails") return "not-modified";
  return "pass";
};

const CHECKS: readonly Check[] = ["unset", "holds", "fails"];
const cases: Conditions[] = [];
for (const read of [false, true])
  for (const ifMatch of CHECKS)
    for (const ifUnmodifiedSince of CHECKS)
      for (const ifNoneMatch of CHECKS)
        for (const ifModifiedSince of CHECKS)
          cases.push({ read, ifMatch, ifUnmodifiedSince, ifNoneMatch, ifModifiedSince });

const none: Conditions = {
  read: true,
  ifMatch: "unset",
  ifUnmodifiedSince: "unset",
  ifNoneMatch: "unset",
  ifModifiedSince: "unset",
};

describe("preconditions", () => {
  it.each(cases)("%j", (conditions) => {
    expect(evaluatePreconditions(conditions)).toBe(oracle(conditions));
  });

  it.each([
    ["no headers pass", none, "pass"],
    ["If-None-Match on GET gives 304", { ...none, ifNoneMatch: "holds" }, "not-modified"],
    ["If-None-Match on PUT gives 412", { ...none, read: false, ifNoneMatch: "holds" }, "failed"],
    ["If-Match that fails gives 412", { ...none, ifMatch: "fails" }, "failed"],
    [
      "If-Match overrides If-Unmodified-Since",
      { ...none, ifMatch: "holds", ifUnmodifiedSince: "fails" },
      "pass",
    ],
    [
      "If-None-Match overrides If-Modified-Since",
      { ...none, ifNoneMatch: "fails", ifModifiedSince: "fails" },
      "pass",
    ],
    [
      "If-Modified-Since is ignored on PUT",
      { ...none, read: false, ifModifiedSince: "fails" },
      "pass",
    ],
  ] as const)("%s", (_, conditions, expected) => {
    expect(evaluatePreconditions(conditions)).toBe(expected);
  });
});
