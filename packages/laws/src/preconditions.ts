import bend, { type BendCheck, type BendVerdict } from "./compiled/preconditions.mjs";

/** A header's result: absent or not applicable, the condition holds, or it fails. */
export type Check = "unset" | "holds" | "fails";

export type Verdict = "pass" | "failed" | "not-modified";

export interface Conditions {
  /** GET or HEAD. */
  readonly read: boolean;
  /** Holds when a listed tag matches strongly, or the list is `*` and the resource exists. */
  readonly ifMatch: Check;
  /** Holds when the resource was not modified after the date. */
  readonly ifUnmodifiedSince: Check;
  /** Holds when a listed tag matches weakly, or the list is `*` and the resource exists. */
  readonly ifNoneMatch: Check;
  /** Holds when the resource was modified after the date. */
  readonly ifModifiedSince: Check;
}

const CHECKS: Record<Check, BendCheck> = {
  unset: { $: "Unset" },
  holds: { $: "Holds" },
  fails: { $: "Fails" },
};
const VERDICTS: Record<BendVerdict["$"], Verdict> = {
  Pass: "pass",
  Failed: "failed",
  NotModified: "not-modified",
};

/** Applies the conditional headers in the order of RFC 9110 §13.2.2. */
export const evaluatePreconditions = (conditions: Conditions): Verdict =>
  VERDICTS[
    bend.evaluate(
      conditions.read,
      CHECKS[conditions.ifMatch],
      CHECKS[conditions.ifUnmodifiedSince],
      CHECKS[conditions.ifNoneMatch],
      CHECKS[conditions.ifModifiedSince],
    ).$
  ];
