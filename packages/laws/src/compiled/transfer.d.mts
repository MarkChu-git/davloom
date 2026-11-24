import type { Ctor } from "../bend";

export type BendNode = Ctor<"Absent"> | Ctor<"File"> | Ctor<"Folder">;
export type BendOutcome =
  | Ctor<"Proceed", { replaces: boolean }>
  | Ctor<"Missing">
  | Ctor<"NoParent">
  | Ctor<"Exists">
  | Ctor<"IsFolder">
  | Ctor<"IntoItself">
  | Ctor<"Root">;

declare const module: {
  decide_write(target: BendNode, parent: BendNode): BendOutcome;
  decide_mkcol(isRoot: boolean, target: BendNode, parent: BendNode): BendOutcome;
  decide_remove(isRoot: boolean, target: BendNode): BendOutcome;
  decide_copy(
    source: BendNode,
    inside: boolean,
    destIsRoot: boolean,
    dest: BendNode,
    destParent: BendNode,
    overwrite: boolean,
  ): BendOutcome;
  decide_move(
    sourceIsRoot: boolean,
    source: BendNode,
    inside: boolean,
    destIsRoot: boolean,
    dest: BendNode,
    destParent: BendNode,
    overwrite: boolean,
  ): BendOutcome;
  within_limit(count: number, limit: number): boolean;
  resume_move(journalMatches: boolean, dest: BendNode): boolean;
};
export default module;
