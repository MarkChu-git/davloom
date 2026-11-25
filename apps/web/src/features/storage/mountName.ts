// The name of a Mount: the folder that WebDAV clients see at the top level of /dav.

import type { Translator } from "../i18n/translate";

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
 * Why a mount cannot use this folder name, or undefined when it can: one path segment that no
 * other mount uses. The server checks the same and more, such as the name's length; this answers
 * the common mistakes without a request.
 */
export const mountNameProblem = (
  t: Translator,
  name: string,
  takenPaths: readonly string[],
): string | undefined => {
  const folder = mountFolderOf(name);
  if (folder === "") {
    return t("mount.nameMissing");
  }
  if (folder.includes("/")) {
    return t("mount.nameSlash");
  }
  if (folder === "." || folder === "..") {
    return t("mount.nameDots");
  }
  if (takenPaths.includes(`/${folder}`)) {
    return t("mount.nameTaken");
  }
  return undefined;
};
