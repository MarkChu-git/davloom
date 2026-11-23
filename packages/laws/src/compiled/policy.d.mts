import type { Ctor } from "../bend";

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
};
export default module;
