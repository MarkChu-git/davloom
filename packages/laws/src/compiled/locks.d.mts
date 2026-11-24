import type { BendList, Ctor } from "../bend";

export type BendScope = Ctor<"Exclusive"> | Ctor<"Shared">;
export type BendDepth = Ctor<"Shallow"> | Ctor<"Deep">;
export type BendPlace = Ctor<"Same"> | Ctor<"Above"> | Ctor<"Below"> | Ctor<"Apart">;
export type BendCondition = Ctor<"Condition", { negated: boolean; holds: boolean }>;
export type BendClause = Ctor<"Clause", { resolved: boolean; conditions: BendList<BendCondition> }>;
export type BendIfState = Ctor<"NoHeader"> | Ctor<"Malformed"> | Ctor<"NoneTrue"> | Ctor<"SomeTrue">;
export type BendGate = Ctor<"Proceed"> | Ctor<"BadHeader"> | Ctor<"Unmet"> | Ctor<"Locked">;
export type BendUnlock = Ctor<"Release"> | Ctor<"NotHere"> | Ctor<"NotYours">;

declare const module: {
  conflicts(held: BendScope, requested: BendScope): boolean;
  covers(depth: BendDepth, place: BendPlace, descendants: boolean): boolean;
  refuses(
    heldScope: BendScope,
    heldDepth: BendDepth,
    place: BendPlace,
    scope: BendScope,
    depth: BendDepth,
  ): boolean;
  condition_true(condition: BendCondition): boolean;
  clause_true(clause: BendClause): boolean;
  header_true(clauses: BendList<BendClause>): boolean;
  if_state(present: boolean, parsed: boolean, clauses: BendList<BendClause>): BendIfState;
  gate(state: BendIfState, blocked: boolean): BendGate;
  decide_unlock(found: boolean, mayLock: boolean): BendUnlock;
};
export default module;
