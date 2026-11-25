import { array, assert, constantFrom, property } from "fast-check";
import { describe, expect, it } from "vitest";
import bend from "./compiled/forwarding.mjs";
import { clientHop, type HopKind } from "./forwarding";

// The reference model, written from the rule: walk from the nearest hop past trusted proxies only;
// an invalid address stands for nothing, so the proxy that wrote it is the client; a chain of
// trusted proxies alone ends at its farthest one.
const model = (hops: readonly HopKind[]): number => {
  for (let index = 0; index < hops.length; index += 1) {
    if (hops[index] === "untrusted") return index;
    if (hops[index] === "invalid") return Math.max(index - 1, 0);
  }
  return hops.length - 1;
};

const KINDS: readonly HopKind[] = ["trusted", "untrusted", "invalid"];

describe("the compiled step", () => {
  it.each([
    ["HTrusted", true, "PNext"],
    ["HTrusted", false, "PThis"],
    ["HUntrusted", true, "PThis"],
    ["HUntrusted", false, "PThis"],
    ["HInvalid", true, "PPrevious"],
    ["HInvalid", false, "PPrevious"],
  ] as const)("%s with more hops %s picks %s", (hop, more, pick) => {
    expect(bend.step({ $: hop }, more).$).toBe(pick);
  });
});

describe("clientHop", () => {
  it.each([
    // [case, hops from the nearest, the client's index]
    ["no hop", [], -1],
    ["a direct client", ["untrusted"], 0],
    ["a direct client that claims an address", ["untrusted", "untrusted"], 0],
    ["a client behind a trusted proxy", ["trusted", "untrusted"], 1],
    ["a client behind two trusted proxies", ["trusted", "trusted", "untrusted"], 2],
    ["a spoofed address left of the client", ["trusted", "untrusted", "untrusted"], 1],
    ["a trusted address the client wrote", ["trusted", "untrusted", "trusted"], 1],
    ["a trusted proxy alone", ["trusted"], 0],
    ["trusted proxies alone", ["trusted", "trusted", "trusted"], 2],
    ["garbage from the proxy", ["trusted", "invalid"], 0],
    ["garbage behind two proxies", ["trusted", "trusted", "invalid", "untrusted"], 1],
    ["garbage left of the client", ["trusted", "untrusted", "invalid"], 1],
  ] as const)("%s", (_case, hops, expected) => {
    expect(clientHop(hops)).toBe(expected);
  });

  it("agrees with the model on every chain", () => {
    assert(
      property(array(constantFrom(...KINDS), { maxLength: 12 }), (hops) => {
        expect(clientHop(hops)).toBe(model(hops));
      }),
    );
  });

  it("never goes past an untrusted hop, whatever the chain holds beyond it", () => {
    assert(
      property(
        array(constantFrom(...KINDS), { maxLength: 6 }),
        array(constantFrom(...KINDS), { maxLength: 6 }),
        (near, far) => {
          const trustedNear = near.map((): HopKind => "trusted");
          const index = clientHop([...trustedNear, "untrusted", ...far]);
          expect(index).toBeLessThanOrEqual(trustedNear.length);
        },
      ),
    );
  });
});
