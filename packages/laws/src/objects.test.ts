import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  classifyObjectError,
  confirmRefusedRead,
  copyRefusal,
  refusedPage,
  type ObjectErrorCode,
  type ObjectFailure,
  type RefusedListing,
  type RefusedRead,
} from "./objects";

const CODES: readonly ObjectErrorCode[] = [
  "not-store",
  "no-such-key",
  "too-large",
  "refused-key",
  "no-code",
  "unwritable-refusal",
  "precondition",
  "full",
  "other",
];
const STATUSES = [undefined, 200, 400, 403, 404, 412, 500, 503, 507];

// The classification as storage/src/s3.ts wrote it before it moved to Bend.
const oracle = (
  code: ObjectErrorCode,
  status: number | undefined,
  head: boolean,
): ObjectFailure => {
  if (code === "not-store") return "unavailable";
  if (code === "no-such-key") return "not-found";
  if (code === "too-large") return "too-large";
  if (status === 400) {
    if (code === "refused-key") return "name-refused";
    if (code === "no-code" && head) return "name-refused";
  }
  if (code === "unwritable-refusal") return "name-refused";
  if (code === "precondition" || status === 412) return "exists";
  if (code === "full" || status === 507) return "insufficient-storage";
  return "unavailable";
};

describe("object store errors", () => {
  for (const code of CODES)
    for (const status of STATUSES)
      for (const head of [false, true])
        it(`${code}, status ${status}, head ${head}: ${oracle(code, status, head)}`, () => {
          expect(classifyObjectError(code, status, head)).toBe(oracle(code, status, head));
        });

  it("takes a key for refused only on the store's word about the key", () => {
    fc.assert(
      fc.property(
        fc.constantFrom(...CODES),
        fc.integer({ min: 100, max: 599 }),
        fc.boolean(),
        (code, status, head) => {
          if (classifyObjectError(code, status, head) !== "name-refused") return;
          expect(
            code === "unwritable-refusal" ||
              (status === 400 && (code === "refused-key" || (code === "no-code" && head))),
          ).toBe(true);
        },
      ),
      { numRuns: 3000 },
    );
  });

  it.each(STATUSES)("a codeless %s to a request other than HEAD is never a refusal", (status) => {
    expect(classifyObjectError("no-code", status, false)).not.toBe("name-refused");
  });
});

describe("refused reads", () => {
  it.each([
    ["shows-key", "fault"],
    ["not-key", "absent"],
    ["refused", "absent"],
    ["failed", "listing-failure"],
  ] as [RefusedListing, RefusedRead][])("a listing that %s: %s", (listing, expected) => {
    expect(confirmRefusedRead(listing)).toBe(expected);
  });

  it("ends a listing at a refused first page only", () => {
    expect(refusedPage(false)).toBe("empty");
    expect(refusedPage(true)).toBe("fault");
  });

  it("says when a refused copy removed what it was to replace", () => {
    expect(copyRefusal(false)).toBe("name-refused");
    expect(copyRefusal(true)).toBe("name-refused-replaced");
  });
});
