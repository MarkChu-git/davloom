import type { Ctor } from "../bend";

export type BendFailure =
  | Ctor<"FNotFound">
  | Ctor<"FNoParent">
  | Ctor<"FExists">
  | Ctor<"FIsCollection">
  | Ctor<"FNotCollection">
  | Ctor<"FIntoItself">
  | Ctor<"FRoot">
  | Ctor<"FInsufficientStorage">
  | Ctor<"FTooLarge">
  | Ctor<"FSizeMismatch">
  | Ctor<"FUnavailable">
  | Ctor<"FNameRefused">
  | Ctor<"FNameRefusedReplaced">
  | Ctor<"FHiddenObjects">
  | Ctor<"FCrossBackend">
  | Ctor<"FTooMany">;

declare const module: { status(failure: BendFailure): number };
export default module;
