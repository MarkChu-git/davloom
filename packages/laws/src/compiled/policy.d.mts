import type { Ctor } from "../bend";

export type BendRelation = Ctor<"Inside"> | Ctor<"Above"> | Ctor<"Outside">;
export type BendAccess = Ctor<"ReadOnly"> | Ctor<"ReadWrite">;
export type BendMethod = Ctor<
  | "MOptions"
  | "MGet"
  | "MHead"
  | "MPropfind"
  | "MPut"
  | "MMkcol"
  | "MDelete"
  | "MProppatch"
  | "MCopy"
  | "MMove"
  | "MLock"
  | "MUnlock"
  | "MOther"
>;

declare const module: {
  authorize(
    access: BendAccess,
    method: BendMethod,
    targetInScope: boolean,
    destinationInScope: boolean,
  ): boolean;
  authorize_scoped(
    access: BendAccess,
    method: BendMethod,
    target: BendRelation,
    destination: BendRelation,
  ): boolean;
};
export default module;
