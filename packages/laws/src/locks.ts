import { toList } from "./bend";
import bend, {
  type BendClause,
  type BendDepth,
  type BendGate,
  type BendIfState,
  type BendPlace,
  type BendScope,
  type BendUnlock,
} from "./compiled/locks.mjs";

export type LockScope = "exclusive" | "shared";
export type LockDepth = "0" | "infinity";
/** Where a lock is rooted, seen from a path: at it, at an ancestor, under it, or elsewhere. */
export type LockPlace = "same" | "above" | "below" | "apart";

/** One condition of an If header: under `Not` or not, and whether its token or tag matches. */
export interface IfConditionFact {
  readonly negated: boolean;
  readonly holds: boolean;
}

/** One list of an If header: whether the request may look at its resource, and its conditions. */
export interface IfClause {
  readonly resolved: boolean;
  readonly conditions: readonly IfConditionFact[];
}

export type IfState = "no-header" | "malformed" | "none-true" | "some-true";
export type LockGate = "proceed" | "bad-header" | "unmet" | "locked";
export type UnlockDecision = "release" | "not-here" | "not-yours";

const SCOPES: Record<LockScope, BendScope> = {
  exclusive: { $: "Exclusive" },
  shared: { $: "Shared" },
};
const DEPTHS: Record<LockDepth, BendDepth> = { "0": { $: "Shallow" }, infinity: { $: "Deep" } };
const PLACES: Record<LockPlace, BendPlace> = {
  same: { $: "Same" },
  above: { $: "Above" },
  below: { $: "Below" },
  apart: { $: "Apart" },
};
const STATES: Record<BendIfState["$"], IfState> = {
  NoHeader: "no-header",
  Malformed: "malformed",
  NoneTrue: "none-true",
  SomeTrue: "some-true",
};
const TO_STATES: Record<IfState, BendIfState> = {
  "no-header": { $: "NoHeader" },
  malformed: { $: "Malformed" },
  "none-true": { $: "NoneTrue" },
  "some-true": { $: "SomeTrue" },
};
const GATES: Record<BendGate["$"], LockGate> = {
  Proceed: "proceed",
  BadHeader: "bad-header",
  Unmet: "unmet",
  Locked: "locked",
};
const UNLOCKS: Record<BendUnlock["$"], UnlockDecision> = {
  Release: "release",
  NotHere: "not-here",
  NotYours: "not-yours",
};

const toClause = (clause: IfClause): BendClause => ({
  $: "Clause",
  resolved: clause.resolved,
  conditions: toList(
    clause.conditions.map((c) => ({ $: "Condition", negated: c.negated, holds: c.holds }) as const),
  ),
});

/** Whether a held lock conflicts with a requested one (RFC 4918 §6.1). */
export const lockConflicts = (held: LockScope, requested: LockScope): boolean =>
  bend.conflicts(SCOPES[held], SCOPES[requested]);

/** Whether a lock covers a path; with `descendants`, a lock rooted under the path counts too. */
export const lockCovers = (depth: LockDepth, place: LockPlace, descendants: boolean): boolean =>
  bend.covers(DEPTHS[depth], PLACES[place], descendants);

/** Whether a held lock refuses a new one, `place` being the held lock's root seen from the new one's. */
export const lockRefuses = (
  held: { readonly scope: LockScope; readonly depth: LockDepth },
  place: LockPlace,
  wanted: { readonly scope: LockScope; readonly depth: LockDepth },
): boolean =>
  bend.refuses(
    SCOPES[held.scope],
    DEPTHS[held.depth],
    PLACES[place],
    SCOPES[wanted.scope],
    DEPTHS[wanted.depth],
  );

/** What an If header comes to (RFC 4918 §10.4): absent, malformed, or whether one list holds. */
export const ifState = (present: boolean, parsed: boolean, clauses: readonly IfClause[]): IfState =>
  STATES[bend.if_state(present, parsed, toList(clauses.map(toClause))).$];

/**
 * Whether a request goes ahead: 400 for a malformed If header, 412 for a false one, then 423 when
 * a lock on what it changes is `blocked`, held by a token the header does not submit.
 */
export const lockGate = (state: IfState, blocked: boolean): LockGate =>
  GATES[bend.gate(TO_STATES[state], blocked).$];

/** UNLOCK (RFC 4918 §9.11): the token's lock must cover the URI and be the credential's to change. */
export const decideUnlock = (found: boolean, mayLock: boolean): UnlockDecision =>
  UNLOCKS[bend.decide_unlock(found, mayLock).$];
