import type { Entry } from "../sample-data/data";

/**
 * Stand-ins for rules the server will own (design.md Decision 2). Each operation takes the sample
 * trees and returns either new trees or the reason it refuses, the way an answer from the API
 * would. When the Dashboard calls the API, this module is deleted and the pages show its answers.
 */
export type Trees = Record<string, Entry[]>;

export type Outcome = { trees: Trees; problem?: undefined } | { problem: string };

export const splitPath = (path: string): string[] => path.split("/").filter((part) => part !== "");

export const joinPath = (parts: readonly string[]): string => `/${parts.join("/")}`;

/** "/documents//Drafts/" becomes "/documents/Drafts". Dot segments stay, and match no folder. */
export const normalizePath = (path: string): string => joinPath(splitPath(path));

/**
 * The tree of a mount, empty until something is stored there. A mount may be named after a
 * property that every object has, such as constructor, so only the trees' own keys count.
 */
const treeOf = (trees: Trees, mountId: string): Entry[] =>
  (Object.hasOwn(trees, mountId) ? trees[mountId] : undefined) ?? [];

/**
 * The entries of the folder at `path`, or undefined when it does not exist. A path names a mount
 * first; a mount with no tree yet is an empty folder, as a mount added during the visit is.
 */
export const folderIn = (
  trees: Trees,
  mountIds: readonly string[],
  path: string,
): Entry[] | undefined => {
  const [mountId, ...folders] = splitPath(path);
  if (mountId === undefined || !mountIds.includes(mountId)) {
    return undefined;
  }
  let entries: Entry[] | undefined = treeOf(trees, mountId);
  for (const name of folders) {
    entries = entries?.find((entry) => entry.kind === "folder" && entry.name === name)?.children;
  }
  return entries;
};

/** New trees with the folder at `path` replaced by `update(entries)`. The folder must exist. */
const updateAt = (trees: Trees, path: string, update: (entries: Entry[]) => Entry[]): Trees => {
  const [mountId, ...folders] = splitPath(path);
  if (mountId === undefined) {
    return trees;
  }
  const descend = (entries: Entry[], depth: number): Entry[] => {
    const name = folders[depth];
    if (name === undefined) {
      return update(entries);
    }
    return entries.map((entry) =>
      entry.kind === "folder" && entry.name === name
        ? { ...entry, children: descend(entry.children ?? [], depth + 1) }
        : entry,
    );
  };
  return { ...trees, [mountId]: descend(treeOf(trees, mountId), 0) };
};

const missing = { problem: "This folder no longer exists." } as const;

/** Why a name cannot be used among `siblings`, or undefined when it can. */
export const nameProblem = (name: string, siblings: readonly Entry[]): string | undefined => {
  const trimmed = name.trim();
  if (trimmed === "") {
    return "Enter a name.";
  }
  if (trimmed.includes("/")) {
    return "Names cannot contain a slash.";
  }
  if (trimmed === "." || trimmed === "..") {
    return "Choose another name.";
  }
  if (siblings.some((entry) => entry.name === trimmed)) {
    return "Something with this name is already here.";
  }
  return undefined;
};

export const createFolderIn = (
  trees: Trees,
  mountIds: readonly string[],
  path: string,
  name: string,
  modifiedAt: string,
): Outcome => {
  const entries = folderIn(trees, mountIds, path);
  if (entries === undefined) {
    return missing;
  }
  const problem = nameProblem(name, entries);
  if (problem !== undefined) {
    return { problem };
  }
  const folder: Entry = {
    name: name.trim(),
    kind: "folder",
    sizeBytes: 0,
    modifiedAt,
    children: [],
  };
  return { trees: updateAt(trees, path, (items) => [...items, folder]) };
};

export const renameIn = (
  trees: Trees,
  mountIds: readonly string[],
  path: string,
  from: string,
  to: string,
  modifiedAt: string,
): Outcome => {
  const entries = folderIn(trees, mountIds, path);
  if (entries === undefined || !entries.some((entry) => entry.name === from)) {
    return { problem: `“${from}” is no longer here.` };
  }
  const problem = nameProblem(
    to,
    entries.filter((entry) => entry.name !== from),
  );
  if (problem !== undefined) {
    return { problem };
  }
  return {
    trees: updateAt(trees, path, (items) =>
      items.map((entry) =>
        entry.name === from ? { ...entry, name: to.trim(), modifiedAt } : entry,
      ),
    ),
  };
};

export const removeIn = (
  trees: Trees,
  mountIds: readonly string[],
  path: string,
  names: ReadonlySet<string>,
): Outcome =>
  folderIn(trees, mountIds, path) === undefined
    ? missing
    : { trees: updateAt(trees, path, (items) => items.filter((entry) => !names.has(entry.name))) };

/** Whether `folder` is `source` or lies inside it. */
const isWithin = (folder: string, source: string): boolean =>
  folder === source || folder.startsWith(`${source}/`);

/** Every folder of the given mounts, each mount root first. */
export const foldersOf = (trees: Trees, mountIds: readonly string[]): string[] => {
  const walk = (entries: readonly Entry[], prefix: readonly string[]): string[] =>
    entries
      .filter((entry) => entry.kind === "folder")
      .flatMap((entry) => {
        const parts = [...prefix, entry.name];
        return [joinPath(parts), ...walk(entry.children ?? [], parts)];
      });
  return mountIds.flatMap((id) => [joinPath([id]), ...walk(treeOf(trees, id), [id])]);
};

/** Where items of `path` can go: any other folder, never one of the items or a folder inside one. */
export const destinationsFor = (
  trees: Trees,
  mountIds: readonly string[],
  path: string,
  names: readonly string[],
): string[] => {
  const sources = names.map((name) => joinPath([...splitPath(path), name]));
  return foldersOf(trees, mountIds).filter(
    (folder) => folder !== path && !sources.some((source) => isWithin(folder, source)),
  );
};

export type Transfer = "move" | "copy";

/**
 * Moves or copies items like a WebDAV request with `Overwrite: F`: it refuses a destination that
 * already holds one of the names, and never puts a folder inside itself.
 */
export const transferIn = (
  trees: Trees,
  mountIds: readonly string[],
  transfer: Transfer,
  from: string,
  names: ReadonlySet<string>,
  to: string,
  modifiedAt: string,
): Outcome => {
  const source = folderIn(trees, mountIds, from);
  const destination = folderIn(trees, mountIds, to);
  if (source === undefined || destination === undefined) {
    return missing;
  }
  if ([...names].some((name) => isWithin(to, joinPath([...splitPath(from), name])))) {
    return { problem: "A folder cannot go inside itself." };
  }
  const taken = destination.find((entry) => names.has(entry.name));
  if (taken !== undefined) {
    return { problem: `“${taken.name}” is already in ${to}.` };
  }
  const items = source.filter((entry) => names.has(entry.name));
  if (items.length !== names.size) {
    return { problem: "Something to move is no longer here." };
  }
  // Updates never change an entry in place, so a copy can share the original's children.
  const arriving = transfer === "move" ? items : items.map((entry) => ({ ...entry, modifiedAt }));
  const without =
    transfer === "move"
      ? updateAt(trees, from, (entries) => entries.filter((entry) => !names.has(entry.name)))
      : trees;
  return { trees: updateAt(without, to, (entries) => [...entries, ...arriving]) };
};

/** Stores a file like a WebDAV PUT: it replaces a file of the same name, and never a folder. */
export const putFileIn = (
  trees: Trees,
  mountIds: readonly string[],
  path: string,
  file: Entry,
): Outcome => {
  const entries = folderIn(trees, mountIds, path);
  if (entries === undefined) {
    return missing;
  }
  if (entries.some((entry) => entry.kind === "folder" && entry.name === file.name)) {
    return { problem: `A folder named “${file.name}” is already here.` };
  }
  return {
    trees: updateAt(trees, path, (items) => [
      ...items.filter((entry) => entry.name !== file.name),
      file,
    ]),
  };
};
