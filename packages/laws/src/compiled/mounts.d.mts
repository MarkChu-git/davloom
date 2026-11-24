import type { Ctor } from "../bend";

export type BendWhere =
  | Ctor<"WRoot">
  | Ctor<"WUnknownTop">
  | Ctor<"WUnknownDeep">
  | Ctor<"WMountRoot">
  | Ctor<"WInside">;
export type BendOp =
  | Ctor<"OpStat">
  | Ctor<"OpList">
  | Ctor<"OpRead">
  | Ctor<"OpWrite">
  | Ctor<"OpMkcol">
  | Ctor<"OpRemove">
  | Ctor<"OpPatch">
  | Ctor<"OpQuota">;
export type BendRoute =
  | Ctor<"Delegate">
  | Ctor<"Virtual">
  | Ctor<"MNotFound">
  | Ctor<"MNoParent">
  | Ctor<"MExists">
  | Ctor<"MIsCollection">
  | Ctor<"MNotCollection">
  | Ctor<"MIntoItself">
  | Ctor<"MRoot">
  | Ctor<"MCrossBackend">;

declare const module: {
  route(op: BendOp, where: BendWhere): BendRoute;
  transfer(from: BendWhere, to: BendWhere, move: boolean, sameBackend: boolean): BendRoute;
};
export default module;
