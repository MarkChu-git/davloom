import type { Path } from "@davloom/core";
import { isValidPath } from "@davloom/laws";

/** Reads the names under `basePath` from a request path, or null when it is not a valid path. */
export const parseDavPath = (pathname: string, basePath: string): Path | null => {
  if (pathname !== basePath && !pathname.startsWith(`${basePath}/`)) return null;
  const segments = pathname
    .slice(basePath.length)
    .split("/")
    .filter((segment) => segment !== "");
  const names: string[] = [];
  for (const segment of segments) {
    try {
      names.push(decodeURIComponent(segment));
    } catch {
      return null;
    }
  }
  return isValidPath(names) ? names : null;
};

/** The URL path of a resource, each name percent-encoded; a collection's ends with `/`. */
export const hrefOf = (basePath: string, path: Path, collection: boolean): string => {
  const encoded = path.map((name) => encodeURIComponent(name)).join("/");
  const href = encoded === "" ? `${basePath}/` : `${basePath}/${encoded}`;
  return collection && !href.endsWith("/") ? `${href}/` : href;
};

export type Destination =
  | { readonly kind: "path"; readonly path: Path }
  | { readonly kind: "foreign" }
  | { readonly kind: "invalid" };

/** Reads a Destination header (RFC 4918 §10.3) relative to the request's URL. */
export const parseDestination = (
  header: string | null,
  requestUrl: URL,
  basePath: string,
): Destination | null => {
  if (header === null) return null;
  let url: URL;
  try {
    url = new URL(header, requestUrl);
  } catch {
    return { kind: "invalid" };
  }
  if (url.host !== requestUrl.host) return { kind: "foreign" };
  if (url.pathname !== basePath && !url.pathname.startsWith(`${basePath}/`))
    return { kind: "foreign" };
  const path = parseDavPath(url.pathname, basePath);
  return path ? { kind: "path", path } : { kind: "invalid" };
};
