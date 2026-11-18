import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { normalizePath } from "../files/tree";
import { scopeOf } from "./scope";

// The law this stand-in shares with the Policy Service (PRD §4, Phase 3): a credential never
// reaches outside its mount and path prefix.
describe("key scope", () => {
  it.each([
    ["", "/documents"],
    ["Invoices 2026", "/documents/Invoices 2026"],
    ["/Invoices 2026/", "/documents/Invoices 2026"],
    ["a//b", "/documents/a/b"],
    ["  Scans  ", "/documents/Scans"],
    ["Invoices 2026 /", "/documents/Invoices 2026"],
    [" a / b ", "/documents/a/b"],
  ])("the folder %j gives the scope %j", (folder, scope) => {
    expect(scopeOf("/documents", folder)).toEqual({ scope });
  });

  it.each(["..", "../photos", "a/../../photos", "./a", "a/.", " .. ", "a/ . /b"])(
    "the folder %j is refused",
    (folder) => {
      expect(scopeOf("/documents", folder).problem).toBeDefined();
    },
  );

  it("a scope never reaches outside its mount", () => {
    const segment = fc.constantFrom("a", "b", ".", "..", " .. ", "", " ", "Invoices 2026 ");
    const folder = fc.array(segment, { maxLength: 4 }).map((parts) => parts.join("/"));
    const mount = fc.constantFrom("/documents", "/photos");
    fc.assert(
      fc.property(mount, folder, fc.boolean(), (mountPath, path, isRooted) => {
        const outcome = scopeOf(mountPath, isRooted ? `/${path}` : path);
        if (outcome.problem === undefined) {
          expect(outcome.scope === mountPath || outcome.scope.startsWith(`${mountPath}/`)).toBe(
            true,
          );
          expect(outcome.scope.split("/")).not.toContain("..");
          expect(outcome.scope.split("/")).not.toContain(".");
          // The Dashboard never names a folder with a space at either end, so no segment has one.
          expect(outcome.scope.split("/").every((part) => part === part.trim())).toBe(true);
          expect(normalizePath(outcome.scope)).toBe(outcome.scope);
        }
      }),
    );
  });

  it("a folder of plain names is accepted as it is", () => {
    const name = fc.constantFrom("a", "b", "Invoices 2026", "2025");
    fc.assert(
      fc.property(fc.array(name, { minLength: 1, maxLength: 4 }), (names) => {
        expect(scopeOf("/documents", names.join("/"))).toEqual({
          scope: `/documents/${names.join("/")}`,
        });
      }),
    );
  });
});
