import { Store, useStore } from "@tanstack/react-store";
import { mounts, type Mount } from "../sample-data/data";

/** The sample mounts, shared by every page for the whole visit. */
const mountStore = new Store<Mount[]>(mounts);

export const useMounts = (): Mount[] => useStore(mountStore, (items) => items);

/** The mounts as they are now, for stores that check a path when an action completes. */
export const currentMountIds = (): string[] => mountStore.state.map((mount) => mount.id);

export const saveMount = (mount: Mount): void => {
  mountStore.setState((items) =>
    items.some((item) => item.id === mount.id)
      ? items.map((item) => (item.id === mount.id ? mount : item))
      : [...items, mount],
  );
};

export const removeMount = (id: string): void => {
  mountStore.setState((items) => items.filter((item) => item.id !== id));
};

const isEdge = (char: string): boolean => /[\s/]/.test(char);

/**
 * The folder a mount takes from the name a user types, without the spaces and slashes around it,
 * so `/ music/ ` becomes `music`. It steps in from each end, because a regex anchored at the end
 * would retry at every space and slash of a long run, in quadratic time.
 */
export const mountFolderOf = (name: string): string => {
  let start = 0;
  let end = name.length;
  while (start < end && isEdge(name.charAt(start))) {
    start += 1;
  }
  while (end > start && isEdge(name.charAt(end - 1))) {
    end -= 1;
  }
  return name.slice(start, end);
};

/**
 * Why a mount cannot use this folder name, or undefined when it can. Stands in for the server's
 * Mount resolution (design.md Decision 2): one path segment that no other mount uses.
 */
export const mountNameProblem = (
  name: string,
  takenPaths: readonly string[],
): string | undefined => {
  const folder = mountFolderOf(name);
  if (folder === "") {
    return "Enter a folder name.";
  }
  if (folder.includes("/")) {
    return "Use one folder name, without slashes.";
  }
  if (folder === "." || folder === "..") {
    return "Choose another folder name.";
  }
  if (takenPaths.includes(`/${folder}`)) {
    return "Another mount already uses this folder.";
  }
  return undefined;
};
