import type { Ctor } from "../bend";

export type BendHop = Ctor<"HTrusted" | "HUntrusted" | "HInvalid">;
export type BendPick = Ctor<"PThis" | "PNext" | "PPrevious">;

declare const module: {
  step(hop: BendHop, more: boolean): BendPick;
};
export default module;
