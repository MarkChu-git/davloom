export {
  decideCopy,
  decideMkcol,
  decideMove,
  decideRemove,
  decideWrite,
  resumeMove,
  withinLimit,
} from "./transfer";
export type { Node, Outcome, TransferFacts } from "./transfer";
export { resolveRange, type RangeSpec, type Resolved } from "./ranges";
export { evaluatePreconditions, type Check, type Conditions, type Verdict } from "./preconditions";
export {
  authorize,
  authorizeScoped,
  METHODS,
  type Access,
  type Method,
  type Relation,
} from "./policy";
export { isValidName, isValidPath } from "./names";
export { planImport, type ImportEntry } from "./imports";
export { decideMigration, type CopyAction, type CopySource, type CopyTarget } from "./copying";
export {
  decideUnlock,
  ifState,
  lockConflicts,
  lockCovers,
  lockGate,
  lockRefuses,
  type IfClause,
  type IfConditionFact,
  type IfState,
  type LockDepth,
  type LockGate,
  type LockPlace,
  type LockScope,
  type UnlockDecision,
} from "./locks";
export { FAILURE_NAMES, failureStatus, type FailureName } from "./statuses";
export {
  propertySource,
  readsDeadProperties,
  type PropertyFacts,
  type PropertySource,
  type PropfindQuery,
} from "./properties";
