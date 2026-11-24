import { MAX_NAT } from "./bend";
import bend, { type BendNode, type BendOutcome } from "./compiled/transfer.mjs";

/** What a path reaches. */
export type Node = "absent" | "file" | "collection";

export type Outcome =
  | { readonly kind: "proceed"; readonly replaces: boolean }
  | { readonly kind: "missing" }
  | { readonly kind: "no-parent" }
  | { readonly kind: "exists" }
  | { readonly kind: "is-collection" }
  | { readonly kind: "into-itself" }
  | { readonly kind: "root" };

const NODES: Record<Node, BendNode> = {
  absent: { $: "Absent" },
  file: { $: "File" },
  collection: { $: "Folder" },
};

const fromBend = (outcome: BendOutcome): Outcome => {
  if (outcome.$ === "Proceed") return { kind: "proceed", replaces: outcome.replaces };
  if (outcome.$ === "Missing") return { kind: "missing" };
  if (outcome.$ === "NoParent") return { kind: "no-parent" };
  if (outcome.$ === "Exists") return { kind: "exists" };
  if (outcome.$ === "IsFolder") return { kind: "is-collection" };
  if (outcome.$ === "IntoItself") return { kind: "into-itself" };
  return { kind: "root" };
};

/** PUT: the target and its parent. */
export const decideWrite = (target: Node, parent: Node): Outcome =>
  fromBend(bend.decide_write(NODES[target], NODES[parent]));

/** MKCOL. */
export const decideMkcol = (isRoot: boolean, target: Node, parent: Node): Outcome =>
  fromBend(bend.decide_mkcol(isRoot, NODES[target], NODES[parent]));

/** DELETE. */
export const decideRemove = (isRoot: boolean, target: Node): Outcome =>
  fromBend(bend.decide_remove(isRoot, NODES[target]));

export interface TransferFacts {
  readonly sourceIsRoot: boolean;
  readonly source: Node;
  /** The destination equals the source, lies under it, or contains it. */
  readonly inside: boolean;
  readonly destinationIsRoot: boolean;
  readonly destination: Node;
  readonly destinationParent: Node;
  readonly overwrite: boolean;
}

/** COPY. The source may be the root: copying the root's content elsewhere is allowed. */
export const decideCopy = (facts: TransferFacts): Outcome =>
  fromBend(
    bend.decide_copy(
      NODES[facts.source],
      facts.inside,
      facts.destinationIsRoot,
      NODES[facts.destination],
      NODES[facts.destinationParent],
      facts.overwrite,
    ),
  );

/** MOVE. */
export const decideMove = (facts: TransferFacts): Outcome =>
  fromBend(
    bend.decide_move(
      facts.sourceIsRoot,
      NODES[facts.source],
      facts.inside,
      facts.destinationIsRoot,
      NODES[facts.destination],
      NODES[facts.destinationParent],
      facts.overwrite,
    ),
  );

/**
 * Whether a copy or move of `count` entries stays within the `limit` a backend handles in one
 * request (the law limit_exact); over the limit, the request executes nothing. Counts and limits
 * past Bend's largest Nat are clamped, which keeps every answer.
 */
export const withinLimit = (count: number, limit: number): boolean => {
  if (!Number.isInteger(count) || !Number.isInteger(limit) || count < 0 || limit < 0) {
    throw new RangeError(`not a count and a limit: ${count}, ${limit}`);
  }
  if (limit >= MAX_NAT) return true;
  if (count > MAX_NAT) return false;
  return bend.within_limit(count, limit);
};

/**
 * Whether a move resumes an earlier one that stopped while removing its source (the laws
 * resume_into_collection and resume_needs_journal): only when the source records a move to this
 * destination, and the destination is a collection.
 */
export const resumeMove = (journalMatches: boolean, destination: Node): boolean =>
  bend.resume_move(journalMatches, NODES[destination]);
