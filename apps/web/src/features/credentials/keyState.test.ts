import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { ALL_MOUNTS, hasExpired, keyStateOf, reachOf, scopeOf } from "./keyState";

const NOW = new Date("2026-11-16T15:30:00Z");

// The rule the server's credential check applies (packages/core verifyApiKey): a key that is off
// never works, and a key that is on works until its expiry time.
describe("key states", () => {
  it.each([
    [{ enabled: true, expiresAt: null }, "active"],
    [{ enabled: true, expiresAt: "2027-01-01T00:00:00Z" }, "active"],
    [{ enabled: true, expiresAt: "2026-11-16T15:30:00Z" }, "expired"],
    [{ enabled: true, expiresAt: "2026-10-31T00:00:00Z" }, "expired"],
    [{ enabled: false, expiresAt: null }, "disabled"],
    [{ enabled: false, expiresAt: "2026-09-30T00:00:00Z" }, "disabled"],
  ])("%j is %s", (key, state) => {
    expect(keyStateOf(key, NOW)).toBe(state);
  });

  it("a key that is off is off whenever it expires, and one that is on expires exactly at its expiry", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        // Drawn often, the expiry time itself and a millisecond either side pin the boundary.
        fc.option(fc.oneof(fc.constantFrom(-1, 0, 1), fc.integer({ min: -1e10, max: 1e10 }))),
        (enabled, offset) => {
          const expiresAt = offset === null ? null : new Date(NOW.getTime() + offset).toISOString();
          const state = keyStateOf({ enabled, expiresAt }, NOW);
          if (!enabled) {
            expect(state).toBe("disabled");
          } else {
            expect(state).toBe(offset !== null && offset <= 0 ? "expired" : "active");
          }
          expect(hasExpired({ expiresAt }, NOW)).toBe(offset !== null && offset <= 0);
        },
      ),
    );
  });
});

describe("scopeOf", () => {
  it.each([
    [ALL_MOUNTS, "", null],
    [ALL_MOUNTS, "photos", null],
    ["files", "", ["/files"]],
    ["files", "photos", ["/files/photos"]],
    ["files", "/photos/2024/", ["/files/photos/2024"]],
    ["files", "//photos//2024", ["/files/photos/2024"]],
    ["files", " photos / 2024 ", ["/files/photos/2024"]],
    ["files", "   ", ["/files"]],
    ["中文", "😀", ["/中文/😀"]],
  ])("reads mount %j and folder %j as %j", (mount, folder, paths) => {
    expect(scopeOf(mount, folder)).toEqual({ paths });
  });

  it.each(["..", "./x", "photos/..", "a/./b", " .. "])("refuses the folder %j", (folder) => {
    expect(scopeOf("files", folder)).toHaveProperty("problem");
  });

  it("limits a key to one root inside its mount for any folder without . or ..", () => {
    const name = fc
      .stringMatching(/^[^/]{1,8}$/)
      .filter((n) => n.trim() !== "" && n.trim() !== "." && n.trim() !== "..");
    fc.assert(
      fc.property(
        name,
        fc.array(fc.oneof(name, fc.constant("")), { maxLength: 6 }),
        (mount, parts) => {
          const scope = scopeOf(mount, parts.join("/"));
          if (!("paths" in scope) || scope.paths === null) {
            throw new Error("expected one root");
          }
          expect(scope.paths).toHaveLength(1);
          const names = (scope.paths[0] ?? "").split("/").slice(1);
          expect(names[0]).toBe(mount);
          expect(names.slice(1)).toEqual(
            parts.map((part) => part.trim()).filter((part) => part !== ""),
          );
          expect(names.slice(1)).not.toContain("");
          expect(names.slice(1)).not.toContain("..");
        },
      ),
    );
  });

  it("names a key's scope", () => {
    expect(reachOf(null)).toBe("All mounts");
    expect(reachOf(["/files/a", "/docs"])).toBe("/files/a, /docs");
    expect(reachOf([])).toBe("Nothing: its folders cannot be read");
  });
});
