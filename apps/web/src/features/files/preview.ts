import type { Entry } from "../api/dav";

/** The largest file whose text the details read for a preview. */
export const PREVIEW_LIMIT_BYTES = 256_000;

const TEXT_EXTENSIONS = new Set([
  "md",
  "markdown",
  "txt",
  "log",
  "csv",
  "tsv",
  "json",
  "yaml",
  "yml",
  "toml",
  "ini",
  "xml",
  "html",
  "css",
  "js",
  "ts",
  "sh",
]);

/** Whether a file is text a preview can show, by its type or, without one, its extension. */
export const isPreviewable = (
  entry: Pick<Entry, "name" | "contentType" | "sizeBytes">,
): boolean => {
  if (entry.sizeBytes > PREVIEW_LIMIT_BYTES) {
    return false;
  }
  const type = entry.contentType.split(";")[0]?.trim().toLowerCase() ?? "";
  if (type.startsWith("text/") || /[/+](json|xml|yaml)$/.test(type)) {
    return true;
  }
  const dot = entry.name.lastIndexOf(".");
  const extension = dot <= 0 ? "" : entry.name.slice(dot + 1).toLowerCase();
  return TEXT_EXTENSIONS.has(extension);
};
