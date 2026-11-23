import { describe, expect, it } from "vitest";
import { authorize, METHODS, type Access } from "./policy";

// The reference model: which methods read or write their target and their destination.
const MODEL: Record<string, { target: "read" | "write"; destination: boolean }> = {
  OPTIONS: { target: "read", destination: false },
  GET: { target: "read", destination: false },
  HEAD: { target: "read", destination: false },
  PROPFIND: { target: "read", destination: false },
  PUT: { target: "write", destination: false },
  MKCOL: { target: "write", destination: false },
  DELETE: { target: "write", destination: false },
  PROPPATCH: { target: "write", destination: false },
  COPY: { target: "read", destination: true },
  MOVE: { target: "write", destination: true },
  LOCK: { target: "write", destination: false },
  UNLOCK: { target: "write", destination: false },
};

const oracle = (access: Access, method: string, target: boolean, destination: boolean) => {
  const rule = Object.hasOwn(MODEL, method) ? MODEL[method] : undefined;
  if (!rule || !target) return false;
  const writes = access === "read-write";
  if (rule.target === "write" && !writes) return false;
  if (rule.destination && !(destination && writes)) return false;
  return true;
};

const ACCESS: readonly Access[] = ["read-only", "read-write"];
const ALL_METHODS = [...METHODS, "POST", "TRACE", "get", "SEARCH", "constructor", "__proto__"];
const cases = ACCESS.flatMap((access) =>
  ALL_METHODS.flatMap((method) =>
    [false, true].flatMap((targetInScope) =>
      [false, true].map((destinationInScope) => ({
        access,
        method,
        targetInScope,
        destinationInScope,
      })),
    ),
  ),
);

describe("policy", () => {
  it.each(cases)("%j", (request) => {
    expect(authorize(request)).toBe(
      oracle(request.access, request.method, request.targetInScope, request.destinationInScope),
    );
  });

  it.each(METHODS)("read_only_never_writes: a Read Only key may %s only if it reads", (method) => {
    const allowed = authorize({
      access: "read-only",
      method,
      targetInScope: true,
      destinationInScope: true,
    });
    expect(allowed).toBe(MODEL[method]?.target === "read" && !MODEL[method]?.destination);
  });

  it.each(METHODS)("denied_outside_scope: %s outside the key's scope is denied", (method) => {
    expect(
      authorize({ access: "read-write", method, targetInScope: false, destinationInScope: true }),
    ).toBe(false);
  });
});
