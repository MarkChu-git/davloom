// Paths as the Files page names them: "/" for the list of Mounts, then a Mount's name, then the
// folders inside it, such as "/files/Drafts".

import type { Translator } from "../i18n/translate";

export const splitPath = (path: string): string[] => path.split("/").filter((part) => part !== "");

export const joinPath = (parts: readonly string[]): string => `/${parts.join("/")}`;

/**
 * "/files//Drafts/" becomes "/files/Drafts". A path with a dot segment names no folder the page
 * shows, and an upload there would land elsewhere, so it becomes the list of Mounts.
 */
export const normalizePath = (path: string): string => {
  const parts = splitPath(path);
  return parts.some((part) => part === "." || part === "..") ? "/" : joinPath(parts);
};

/**
 * Why a name cannot be used among `siblings`, or undefined when it can. The server decides in the
 * end; this saves a request for the mistakes a person makes most.
 */
export const nameProblem = (
  t: Translator,
  name: string,
  siblings: readonly string[],
): string | undefined => {
  const trimmed = name.trim();
  if (trimmed === "") {
    return t("name.missing");
  }
  if (trimmed.includes("/")) {
    return t("name.slash");
  }
  if (trimmed === "." || trimmed === "..") {
    return t("name.dots");
  }
  if (siblings.includes(trimmed)) {
    return t("name.taken");
  }
  return undefined;
};

/** Whether `folder` is `source` or lies inside it. */
export const isWithin = (folder: string, source: string): boolean =>
  folder === source || folder.startsWith(`${source}/`);

/**
 * Why items of `from` cannot go to the folder at `to`, or undefined when they can: the folder
 * must lie inside a Mount, differ from where they are, and not be one of them or inside one.
 */
export const destinationProblem = (
  t: Translator,
  from: string,
  names: readonly string[],
  to: string,
): string | undefined => {
  if (splitPath(to).some((part) => part === "." || part === "..")) {
    return t("destination.dots");
  }
  const target = normalizePath(to);
  if (splitPath(target).length === 0) {
    return t("destination.root");
  }
  if (target === normalizePath(from)) {
    return t("destination.same");
  }
  const sources = names.map((name) => joinPath([...splitPath(from), name]));
  if (sources.some((source) => isWithin(target, source))) {
    return t("destination.inside");
  }
  return undefined;
};

/** The Files URL for a folder, and optionally the file whose details are open. */
export const filesHref = (path: string, file?: string): string => {
  const search = new URLSearchParams();
  if (path !== "/") {
    search.set("path", path);
  }
  if (file !== undefined) {
    search.set("file", file);
  }
  const query = search.toString();
  return query === "" ? "/files" : `/files?${query}`;
};
