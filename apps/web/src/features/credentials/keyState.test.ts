import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { hasExpired, keyStateOf } from "./keyState";

const NOW = new Date("2026-11-16T15:30:00Z");

// The law this stand-in shares with Better Auth's credential expiry and revocation (PRD §6):
// revocation is final, and a key that is not revoked expires at its expiry time.
describe("key states", () => {
  it.each([
    [{ isRevoked: false, expiresAt: null }, "active"],
    [{ isRevoked: false, expiresAt: "2027-01-01T00:00:00Z" }, "active"],
    [{ isRevoked: false, expiresAt: "2026-11-16T15:30:00Z" }, "expired"],
    [{ isRevoked: false, expiresAt: "2026-10-31T00:00:00Z" }, "expired"],
    [{ isRevoked: true, expiresAt: null }, "revoked"],
    [{ isRevoked: true, expiresAt: "2026-09-30T00:00:00Z" }, "revoked"],
  ])("%j is %s", (credential, state) => {
    expect(keyStateOf(credential, NOW)).toBe(state);
  });

  it("a revoked key is revoked whenever it expires, and an unrevoked one is expired exactly from its expiry", () => {
    fc.assert(
      fc.property(
        fc.boolean(),
        fc.option(fc.integer({ min: -1e10, max: 1e10 })),
        (isRevoked, offset) => {
          const expiresAt = offset === null ? null : new Date(NOW.getTime() + offset).toISOString();
          const state = keyStateOf({ isRevoked, expiresAt }, NOW);
          if (isRevoked) {
            expect(state).toBe("revoked");
          } else {
            expect(state).toBe(offset !== null && offset <= 0 ? "expired" : "active");
          }
          // A key's row says Expired exactly when its expiry has come, revoked or not, so an
          // unrevoked key's words always agree with its status.
          expect(hasExpired({ expiresAt }, NOW)).toBe(offset !== null && offset <= 0);
          if (!isRevoked) {
            expect(hasExpired({ expiresAt }, NOW)).toBe(state === "expired");
          }
        },
      ),
    );
  });
});
