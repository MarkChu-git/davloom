import bend, { type BendMethod, type BendRelation } from "./compiled/policy.mjs";

export type Access = "read-only" | "read-write";

export const METHODS = [
  "OPTIONS",
  "GET",
  "HEAD",
  "PROPFIND",
  "PUT",
  "MKCOL",
  "DELETE",
  "PROPPATCH",
  "COPY",
  "MOVE",
  "LOCK",
  "UNLOCK",
] as const;
export type Method = (typeof METHODS)[number];

const BEND_METHODS: Record<Method, BendMethod["$"]> = {
  OPTIONS: "MOptions",
  GET: "MGet",
  HEAD: "MHead",
  PROPFIND: "MPropfind",
  PUT: "MPut",
  MKCOL: "MMkcol",
  DELETE: "MDelete",
  PROPPATCH: "MProppatch",
  COPY: "MCopy",
  MOVE: "MMove",
  LOCK: "MLock",
  UNLOCK: "MUnlock",
};

export interface Request {
  readonly access: Access;
  /** The HTTP method as sent; anything outside METHODS is denied. */
  readonly method: string;
  readonly targetInScope: boolean;
  /** For COPY and MOVE; ignored for the other methods. */
  readonly destinationInScope: boolean;
}

const isMethod = (method: string): method is Method => Object.hasOwn(BEND_METHODS, method);

/** Whether an API Key may make a WebDAV request. */
export const authorize = ({ access, method, targetInScope, destinationInScope }: Request) =>
  bend.authorize(
    { $: access === "read-write" ? "ReadWrite" : "ReadOnly" },
    { $: isMethod(method) ? BEND_METHODS[method] : "MOther" },
    targetInScope,
    destinationInScope,
  );

/** Where a path lies relative to a key's scope. */
export type Relation = "inside" | "above" | "outside";

const RELATIONS: Record<Relation, BendRelation> = {
  inside: { $: "Inside" },
  above: { $: "Above" },
  outside: { $: "Outside" },
};

export interface ScopedRequest {
  readonly access: Access;
  readonly method: string;
  readonly target: Relation;
  /** For COPY and MOVE; ignored for the other methods. */
  readonly destination: Relation;
}

/**
 * Whether an API Key with a scope may make a WebDAV request: inside its roots as `authorize`
 * decides, above them only to browse, elsewhere never.
 */
export const authorizeScoped = ({ access, method, target, destination }: ScopedRequest) =>
  bend.authorize_scoped(
    { $: access === "read-write" ? "ReadWrite" : "ReadOnly" },
    { $: isMethod(method) ? BEND_METHODS[method] : "MOther" },
    RELATIONS[target],
    RELATIONS[destination],
  );
