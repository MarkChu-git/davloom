import bend, { type BendOp, type BendRoute, type BendWhere } from "./compiled/mounts.mjs";

/** Where a path lies in the namespace of Mounts. */
export type MountWhere = "root" | "unknown-top" | "unknown-deep" | "mount-root" | "inside";
export type MountOp = "stat" | "list" | "read" | "write" | "mkcol" | "remove" | "patch" | "quota";
export type MountRoute =
  | "delegate"
  | "virtual"
  | "not-found"
  | "no-parent"
  | "exists"
  | "is-collection"
  | "not-collection"
  | "into-itself"
  | "root"
  | "cross-backend";

const WHERE: Record<MountWhere, BendWhere> = {
  root: { $: "WRoot" },
  "unknown-top": { $: "WUnknownTop" },
  "unknown-deep": { $: "WUnknownDeep" },
  "mount-root": { $: "WMountRoot" },
  inside: { $: "WInside" },
};
const OPS: Record<MountOp, BendOp> = {
  stat: { $: "OpStat" },
  list: { $: "OpList" },
  read: { $: "OpRead" },
  write: { $: "OpWrite" },
  mkcol: { $: "OpMkcol" },
  remove: { $: "OpRemove" },
  patch: { $: "OpPatch" },
  quota: { $: "OpQuota" },
};
const ROUTES: Record<BendRoute["$"], MountRoute> = {
  Delegate: "delegate",
  Virtual: "virtual",
  MNotFound: "not-found",
  MNoParent: "no-parent",
  MExists: "exists",
  MIsCollection: "is-collection",
  MNotCollection: "not-collection",
  MIntoItself: "into-itself",
  MRoot: "root",
  MCrossBackend: "cross-backend",
};

/** Whether an operation on a path goes to its Mount's backend (laws mount_route_inside and on). */
export const mountRoute = (op: MountOp, where: MountWhere): MountRoute =>
  ROUTES[bend.route(OPS[op], WHERE[where]).$];

/** Whether a copy or move goes to the backend (laws mount_transfer_safe, mount_transfer_reaches). */
export const mountTransfer = (
  from: MountWhere,
  to: MountWhere,
  move: boolean,
  sameBackend: boolean,
): MountRoute => ROUTES[bend.transfer(WHERE[from], WHERE[to], move, sameBackend).$];
