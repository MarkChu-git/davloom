import fc from "fast-check";
import { describe, expect, it } from "vitest";
import bend from "./compiled/verification.mjs";
import {
  ACTION_EFFECTS,
  verificationLevel,
  verificationPermits,
  type ActionEffect,
  type VerificationLevel,
} from "./verification";

// The reference model, written from the owner's rule: whatever deletes, overwrites or discloses
// data or touches a credential asks for step-up; signing this browser out asks for a confirmation.
const LEVEL: Record<ActionEffect, VerificationLevel> = {
  read: "none",
  change: "none",
  "end-self": "confirm",
  destroy: "step-up",
  credential: "step-up",
  disclose: "step-up",
};

describe("verificationLevel", () => {
  it.each(ACTION_EFFECTS.map((effect) => [effect, LEVEL[effect]] as const))(
    "%s asks for %s",
    (effect, level) => {
      expect(verificationLevel(effect)).toBe(level);
    },
  );
});

describe("verificationPermits", () => {
  const cases = ACTION_EFFECTS.flatMap((effect) =>
    [false, true].map((fresh) => [effect, fresh, LEVEL[effect] !== "step-up" || fresh] as const),
  );
  it.each(cases)("%s with a fresh verification %s is permitted: %s", (effect, fresh, expected) => {
    expect(verificationPermits(effect, fresh)).toBe(expected);
  });

  it("agrees with the compiled allows for every level", () => {
    fc.assert(
      fc.property(fc.constantFrom(...ACTION_EFFECTS), fc.boolean(), (effect, fresh) => {
        const level = bend.level({
          $: (
            {
              read: "EffRead",
              change: "EffChange",
              "end-self": "EffEndSelf",
              destroy: "EffDestroy",
              credential: "EffCredential",
              disclose: "EffDisclose",
            } as const
          )[effect],
        });
        expect(bend.allows(level, fresh)).toBe(verificationPermits(effect, fresh));
      }),
    );
  });
});
