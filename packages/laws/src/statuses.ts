import bend, { type BendFailure } from "./compiled/statuses.mjs";

/** The storage contract's failures, as `@davloom/core` names them. */
export type FailureName =
  | "not-found"
  | "no-parent"
  | "exists"
  | "is-collection"
  | "not-collection"
  | "into-itself"
  | "root"
  | "insufficient-storage"
  | "too-large"
  | "size-mismatch"
  | "unavailable"
  | "name-refused"
  | "name-refused-replaced"
  | "hidden-objects"
  | "cross-backend"
  | "too-many";

const FAILURES: Record<FailureName, BendFailure> = {
  "not-found": { $: "FNotFound" },
  "no-parent": { $: "FNoParent" },
  exists: { $: "FExists" },
  "is-collection": { $: "FIsCollection" },
  "not-collection": { $: "FNotCollection" },
  "into-itself": { $: "FIntoItself" },
  root: { $: "FRoot" },
  "insufficient-storage": { $: "FInsufficientStorage" },
  "too-large": { $: "FTooLarge" },
  "size-mismatch": { $: "FSizeMismatch" },
  unavailable: { $: "FUnavailable" },
  "name-refused": { $: "FNameRefused" },
  "name-refused-replaced": { $: "FNameRefusedReplaced" },
  "hidden-objects": { $: "FHiddenObjects" },
  "cross-backend": { $: "FCrossBackend" },
  "too-many": { $: "FTooMany" },
};

export const FAILURE_NAMES: readonly FailureName[] = [
  "not-found",
  "no-parent",
  "exists",
  "is-collection",
  "not-collection",
  "into-itself",
  "root",
  "insufficient-storage",
  "too-large",
  "size-mismatch",
  "unavailable",
  "name-refused",
  "name-refused-replaced",
  "hidden-objects",
  "cross-backend",
  "too-many",
];

/** The HTTP status that answers a failure (laws failure_status_exact and failure_class_exact). */
export const failureStatus = (failure: FailureName): number => bend.status(FAILURES[failure]);
