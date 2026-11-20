import { describe, expect, it } from "vitest";

describe("the storage fixture", () => {
  it("Replacing a file: Durable Objects", () => {
    expect(true).toBe(true);
  });

  describe("collections", () => {
    it("Creating a collection", () => {
      expect(true).toBe(true);
    });
  });
});

// The check lists the tests with DAVLOOM_LIST_TESTS set, which a contract suite reads to start no
// container, so this test carries its scenario's name only while the check lists it.
it(
  process.env["DAVLOOM_LIST_TESTS"] === "1"
    ? "Listing without containers"
    : "Listing with containers",
  () => {
    expect(true).toBe(true);
  },
);
