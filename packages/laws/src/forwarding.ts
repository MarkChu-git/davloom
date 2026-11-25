import bend, { type BendHop } from "./compiled/forwarding.mjs";

/**
 * A hop of a forwarded request, as the deployment sees it: one of its trusted proxies, any other
 * address, or something that is no address.
 */
export type HopKind = "trusted" | "untrusted" | "invalid";

const HOPS: Record<HopKind, BendHop> = {
  trusted: { $: "HTrusted" },
  untrusted: { $: "HUntrusted" },
  invalid: { $: "HInvalid" },
};

/**
 * Which hop of a forwarded request is its client (the laws forwarding_*): `hops` lists them from
 * the nearest, the socket's peer, to the farthest, the left-most X-Forwarded-For address. The
 * answer is the nearest hop that is no trusted proxy; the trusted proxy that wrote an invalid hop;
 * or the farthest hop of a chain of trusted proxies. An empty chain answers -1.
 */
export const clientHop = (hops: readonly HopKind[]): number => {
  for (let index = 0; index < hops.length; index += 1) {
    const hop = hops[index] ?? "invalid";
    const pick = bend.step(HOPS[hop], index < hops.length - 1).$;
    if (pick === "PThis") return index;
    // The nearest hop is the socket's peer, which is always an address.
    if (pick === "PPrevious") return Math.max(index - 1, 0);
  }
  return -1;
};
