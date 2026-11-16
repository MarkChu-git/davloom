import { joinPath, splitPath } from "../files/tree";

export type Scope = { scope: string; problem?: undefined } | { problem: string };

/**
 * Stands in for the Policy Service's path prefix scope (PRD §6, design.md Decision 2): the scope of
 * a key that a folder inside `mountPath` limits, or why the folder cannot limit it. Slashes are
 * normalized, spaces around each segment are dropped, as the Dashboard never names a folder that
 * way, and a `.` or `..` segment is refused, so a scope never reaches outside its mount.
 */
export const scopeOf = (mountPath: string, folder: string): Scope => {
  const parts = splitPath(folder)
    .map((part) => part.trim())
    .filter((part) => part !== "");
  if (parts.some((part) => part === "." || part === "..")) {
    return { problem: "Name a folder inside the mount, without . or .. in its path." };
  }
  return { scope: joinPath([...splitPath(mountPath), ...parts]) };
};
