// Serves the Dashboard's build from files embedded in the Worker, for the fallback deploy of
// scripts/deploy-embedded.ts where Wrangler's asset upload is blocked. It answers as Workers
// static assets answer with Davloom's config: the file at the path, else `<path>.html`, else
// `<path>/index.html`, else index.html for a path without an extension (single-page-application),
// 404 otherwise; GET and HEAD only; an ETag and 304 for If-None-Match; Cache-Control
// `public, max-age=0, must-revalidate` unless a rule of `_headers` sets its own. Production
// deploys with Workers static assets (apps/api/wrangler.jsonc) and never runs this file.

export interface EmbeddedFile {
  /** The Content-Type, as Bun names it for the file's extension. */
  readonly type: string;
  /** The bytes of a text file as its UTF-8 text, which compresses better than base64. */
  readonly text?: string;
  /** The bytes of any other file, base64-encoded. */
  readonly base64?: string;
  /** A strong validator of the bytes. */
  readonly etag: string;
}

/** A rule of a `_headers` file: a path pattern and the headers to set and to remove. */
export interface HeaderRule {
  readonly pattern: string;
  readonly set: readonly (readonly [string, string])[];
  readonly unset: readonly string[];
}

/** What Workers static assets send by default: check with the server on every use. */
export const DEFAULT_CACHE_CONTROL = "public, max-age=0, must-revalidate";

/**
 * The rules of a `_headers` file (Cloudflare's format): a line that starts at the margin names a
 * path, `*` matching any run of characters; indented `Name: value` lines below it set a header,
 * and `! Name` lines remove one. Comments start with `#`.
 */
export const parseHeaders = (text: string): HeaderRule[] => {
  const rules: { pattern: string; set: [string, string][]; unset: string[] }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("#")) continue;
    if (!/^\s/.test(line)) {
      rules.push({ pattern: trimmed, set: [], unset: [] });
      continue;
    }
    const rule = rules.at(-1);
    if (rule === undefined) continue;
    if (trimmed.startsWith("!")) {
      rule.unset.push(trimmed.slice(1).trim());
      continue;
    }
    const colon = trimmed.indexOf(":");
    if (colon <= 0) continue;
    rule.set.push([trimmed.slice(0, colon).trim(), trimmed.slice(colon + 1).trim()]);
  }
  return rules;
};

const escapeRegExp = (text: string) => text.replace(/[.+?^${}()|[\]\\]/g, "\\$&");

/** Whether a `_headers` pattern matches a path. */
export const matchesPattern = (pattern: string, pathname: string): boolean =>
  new RegExp(`^${pattern.split("*").map(escapeRegExp).join(".*")}$`).test(pathname);

const bytesOf = (file: EmbeddedFile): Uint8Array<ArrayBuffer> =>
  file.text === undefined
    ? Uint8Array.from(atob(file.base64 ?? ""), (character) => character.charCodeAt(0))
    : new TextEncoder().encode(file.text);

/** The embedded file a path names, by the rules of Workers static assets; null for none. */
export const resolveAsset = (
  files: Readonly<Record<string, EmbeddedFile>>,
  pathname: string,
): { readonly path: string; readonly file: EmbeddedFile } | null => {
  const bare = pathname.replace(/\/+$/, "");
  for (const path of [pathname, `${bare}.html`, `${bare}/index.html`]) {
    // `/` itself is not a file; its page is /index.html.
    if (path.endsWith("/") || !Object.hasOwn(files, path)) continue;
    const file = files[path];
    if (file !== undefined) return { path, file };
  }
  const last = bare.slice(bare.lastIndexOf("/") + 1);
  const index = files["/index.html"];
  if (!last.includes(".") && index !== undefined) return { path: "/index.html", file: index };
  return null;
};

/** Whether an If-None-Match header names the ETag, or `*` (RFC 9110 §13.1.2, weak comparison). */
const noneMatch = (header: string | null, etag: string) =>
  header !== null &&
  header.split(",").some((entry) => {
    const tag = entry.trim();
    return tag === "*" || tag.replace(/^W\//, "") === etag;
  });

/** A fetch handler that serves the embedded files. */
export const createAssetServer = (
  files: Readonly<Record<string, EmbeddedFile>>,
  headersFile = "",
) => {
  const rules = parseHeaders(headersFile);
  return (request: Request): Response => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    }
    const { pathname } = new URL(request.url);
    let decoded: string;
    try {
      decoded = decodeURIComponent(pathname);
    } catch {
      return new Response(null, { status: 404 });
    }
    const found = resolveAsset(files, decoded);
    if (found === null) return new Response(null, { status: 404 });
    const headers = new Headers({
      "content-type": found.file.type,
      etag: found.file.etag,
      "cache-control": DEFAULT_CACHE_CONTROL,
    });
    for (const rule of rules) {
      if (!matchesPattern(rule.pattern, decoded)) continue;
      for (const name of rule.unset) headers.delete(name);
      for (const [name, value] of rule.set) headers.set(name, value);
    }
    if (noneMatch(request.headers.get("if-none-match"), found.file.etag)) {
      headers.delete("content-type");
      return new Response(null, { status: 304, headers });
    }
    const body = bytesOf(found.file);
    headers.set("content-length", String(body.byteLength));
    return new Response(request.method === "HEAD" ? null : body, { headers });
  };
};
