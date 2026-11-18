import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { UPLOAD_LIMIT_BYTES, uploadProblem } from "./uploadStore";

// The limit stands in for the Cloud Free request body limit, which the platform enforces.
describe("upload size", () => {
  it.each([
    [0, false],
    [UPLOAD_LIMIT_BYTES, false],
    [UPLOAD_LIMIT_BYTES + 1, true],
    [150_000_000, true],
  ])("a file of %d bytes is refused: %s", (sizeBytes, isRefused) => {
    expect(uploadProblem(sizeBytes) !== undefined).toBe(isRefused);
  });

  it("a file is refused exactly when it is over 100 MB", () => {
    // Sizes near the limit, where an off-by-one would show, and sizes anywhere up to twice it.
    const size = fc.oneof(
      fc.integer({ min: UPLOAD_LIMIT_BYTES - 3, max: UPLOAD_LIMIT_BYTES + 3 }),
      fc.integer({ min: 0, max: 2 * UPLOAD_LIMIT_BYTES }),
    );
    fc.assert(
      fc.property(size, (sizeBytes) => {
        expect(uploadProblem(sizeBytes) !== undefined).toBe(sizeBytes > 100_000_000);
      }),
    );
  });
});
