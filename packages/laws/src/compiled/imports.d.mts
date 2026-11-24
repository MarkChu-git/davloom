import type { BendList, Ctor } from "../bend";

export type BendEntry = Ctor<"Entry", { defines: BendList<number>; needs: BendList<number> }>;
export type BendPlan = Ctor<"Apply", { entries: BendList<BendEntry> }> | Ctor<"Reject">;

declare const module: {
  valid(entries: BendList<BendEntry>, known: BendList<number>): boolean;
  plan(entries: BendList<BendEntry>, known: BendList<number>): BendPlan;
};
export default module;
