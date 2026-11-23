import { describe, expect, it } from "vitest";
import { createMemoryPropertyStore, isKeyWithin } from "./property-store";
import { propertyStoreContract } from "./testing/property-store-contract";

propertyStoreContract("memory", { make: createMemoryPropertyStore });

describe("isKeyWithin", () => {
  it.each([
    ["a", "a", true],
    ["a/b", "a", true],
    ["a b", "a", false],
    ["ab", "a", false],
    ["a", "a/b", false],
    ["anything", "", true],
    ["", "", true],
  ])("%j within %j is %j", (key, root, expected) => {
    expect(isKeyWithin(key, root)).toBe(expected);
  });
});
