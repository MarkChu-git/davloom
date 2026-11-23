import { isValidPath, type Relation } from "@davloom/laws";
import { isWithin, ok, type Path, type StorageBackend } from "./storage";

// Mount and Path Prefix Scope (PRD §6). A key's scope is a list of roots in the WebDAV namespace,
// each a Mount or a folder inside one, such as /files or /files/photos; a key without one reaches
// every Mount. The proven policy decides what a key may do inside, above and outside its roots.

/** A key's roots, or null for every Mount. */
export type Scope = readonly Path[] | null;

export const MAX_SCOPE_ROOTS = 16;

/** Reads the roots a key was created with; null when the list is invalid. */
export const parseScope = (value: unknown): readonly Path[] | null => {
  if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SCOPE_ROOTS) return null;
  const roots: Path[] = [];
  for (const item of value) {
    if (typeof item !== "string") return null;
    const names = item.split("/").filter((name) => name !== "");
    if (names.length === 0 || !isValidPath(names)) return null;
    roots.push(names);
  }
  return roots;
};

/** The text of a root, as the API shows it. */
export const formatRoot = (root: Path): string => `/${root.join("/")}`;

/** Where a path lies relative to a scope. */
export const relationOf = (path: Path, scope: Scope): Relation => {
  if (scope === null) return "inside";
  if (scope.some((root) => isWithin(path, root))) return "inside";
  if (scope.some((root) => isWithin(root, path))) return "above";
  return "outside";
};

/**
 * The namespace as a scoped key sees it: a listing above the key's roots shows only what leads to
 * them. Every other operation passes through, and the policy refuses what lies outside the scope.
 */
export const scopeStorage = (storage: StorageBackend, scope: Scope): StorageBackend => {
  if (scope === null) return storage;
  return {
    ...storage,
    list: async (path) => {
      const listed = await storage.list(path);
      if (!listed.ok || relationOf(path, scope) === "inside") return listed;
      return ok(listed.value.filter((entry) => relationOf(entry.path, scope) !== "outside"));
    },
  };
};
