import { extname, join, resolve, sep } from "node:path";

const API_PATHS = /^\/(api|dav)(\/|$)/;
const READ_METHODS = new Set(["GET", "HEAD"]);

const notFound = () => new Response(null, { status: 404 });

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

    const file = Bun.file(requested);
    if (requested !== root && (await file.exists())) {
      return new Response(file);
    }
    // A path with an extension asked for a specific file, so the Dashboard is not the answer.
    return extname(decodedPath) ? notFound() : new Response(Bun.file(indexFile));
  };
};
