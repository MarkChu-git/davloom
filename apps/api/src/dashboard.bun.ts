import { extname, join, resolve, sep } from "node:path";

const API_PATHS = /^\/(api|dav)(\/|$)/;
const READ_METHODS = new Set(["GET", "HEAD"]);

const notFound = () => new Response(null, { status: 404 });

// The text types of the Dashboard's build, which gzip makes several times smaller. Cloudflare
// compresses what Workers serve at its edge; a Bun deployment has no edge, so it does it here.
const COMPRESSIBLE = /^(text\/|application\/(javascript|json|xml|manifest\+json)|image\/svg\+xml)/;
// Below this size, gzip's own header outweighs what it saves.
const MIN_COMPRESSED_BYTES = 1024;
// A file under /assets/ has its content hash in its name, so it never changes. Every other file,
// index.html above all, is checked on each visit: the same as Workers static assets answer.
const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=0, must-revalidate";

/** Whether an Accept-Encoding takes gzip (RFC 9110 §12.5.3); q=0 means it does not. */
export const acceptsGzip = (header: string | null): boolean => {
  let gzip: number | undefined;
  let any: number | undefined;
  for (const entry of (header ?? "").split(",")) {
    const [coding = "", ...parameters] = entry.split(";").map((part) => part.trim().toLowerCase());
    const q = parameters.find((parameter) => parameter.startsWith("q="));
    const weight = q === undefined ? 1 : Number(q.slice(2));
    if (coding === "gzip" || coding === "x-gzip") gzip = weight;
    if (coding === "*") any = weight;
  }
  // A coding named on its own takes precedence over `*`.
  const weight = gzip ?? any ?? 0;
  return Number.isFinite(weight) && weight > 0;
};

// The gzip of each file by path, kept while its size and modification time stay the same.
const compressed = new Map<string, { version: string; body: Uint8Array<ArrayBuffer> }>();

const gzipOf = async (path: string, file: Bun.BunFile): Promise<Uint8Array<ArrayBuffer>> => {
  const version = `${file.size}:${file.lastModified}`;
  const cached = compressed.get(path);
  if (cached?.version === version) return cached.body;
  const body = Bun.gzipSync(new Uint8Array(await file.arrayBuffer()), { level: 9 });
  compressed.set(path, { version, body });
  return body;
};

/** Answers with a file, gzipped when the client takes gzip and the file's type gains from it. */
const serveFile = async (request: Request, path: string, cacheControl: string) => {
  const file = Bun.file(path);
  const headers = new Headers({ "content-type": file.type, "cache-control": cacheControl });
  if (!COMPRESSIBLE.test(file.type) || file.size < MIN_COMPRESSED_BYTES) {
    return new Response(file, { headers });
  }
  headers.set("vary", "accept-encoding");
  if (!acceptsGzip(request.headers.get("accept-encoding"))) {
    return new Response(file, { headers });
  }
  headers.set("content-encoding", "gzip");
  return new Response(await gzipOf(path, file), { headers });
};

/**
 * Serves the Dashboard's production build from disk, the way Workers static assets do: a file if one
 * exists, otherwise index.html so that the client-side router can handle the path.
 */
export const createDashboardHandler = (directory: string) => {
  const root = resolve(directory);
  const indexFile = join(root, "index.html");

  return async (request: Request): Promise<Response> => {
    const { pathname } = new URL(request.url);
    if (API_PATHS.test(pathname)) {
      return notFound();
    }
    if (!READ_METHODS.has(request.method)) {
      return new Response(null, { status: 405, headers: { allow: "GET, HEAD" } });
    }

    let decodedPath: string;
    try {
      decodedPath = decodeURIComponent(pathname);
    } catch {
      return notFound();
    }
    // The file system cannot represent a null byte, and Bun throws when asked to open one.
    if (decodedPath.includes("\0")) {
      return notFound();
    }
    const requested = resolve(root, `.${decodedPath}`);
    if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
      return notFound();
    }

    if (requested !== root && (await Bun.file(requested).exists())) {
      const isAsset = requested.startsWith(`${root}${sep}assets${sep}`);
      return serveFile(request, requested, isAsset ? IMMUTABLE : REVALIDATE);
    }
    // A path with an extension asked for a specific file, so the Dashboard is not the answer.
    return extname(decodedPath) ? notFound() : serveFile(request, indexFile, REVALIDATE);
  };
};
