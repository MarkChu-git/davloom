// Cross-site request forgery: a page on another site can make the browser send a form or a simple
// fetch to /api with the owner's session cookie. Every /api request that changes something has to
// come from the instance's own origin, as the Origin header says, or as Sec-Fetch-Site says when a
// browser sends no Origin, and has to carry JSON, which a form cannot send and a cross-site fetch
// can only send after a preflight that Davloom never answers. WebDAV under /dav is not affected: a
// browser does not send the Dashboard's header or WebDAV's methods across sites without a
// preflight either, and WebDAV clients authenticate with an API Key instead of a cookie.

/** The methods that change nothing, which a cross-site page may send. */
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

const refusal = (status: number, code: string) => Response.json({ error: { code } }, { status });

/**
 * The origins a request to this instance may come from: the configured public origin
 * (DAVLOOM_URL), or without one the origin the request was sent to, on HTTPS too when a proxy in
 * front says the client used it.
 */
const allowedOrigins = (url: URL, request: Request, publicOrigin: string | undefined) => {
  if (publicOrigin !== undefined) return [publicOrigin];
  const forwarded = request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  return forwarded === "https" && url.protocol === "http:"
    ? [url.origin, `https://${url.host}`]
    : [url.origin];
};

const isJson = (contentType: string | null) =>
  (contentType ?? "").split(";")[0]?.trim().toLowerCase() === "application/json";

/**
 * The refusal of an /api request that changes something and comes from another site or carries
 * something else than JSON: 403 cross_site or 415 unsupported_media_type; undefined to let it run.
 */
export const crossSiteRefusal = (request: Request, publicOrigin?: string): Response | undefined => {
  if (SAFE_METHODS.has(request.method.toUpperCase())) return undefined;
  if (!URL.canParse(request.url)) return refusal(403, "cross_site");
  const url = new URL(request.url);
  if (url.pathname !== "/api" && !url.pathname.startsWith("/api/")) return undefined;
  const origin = request.headers.get("origin");
  const sameOrigin =
    origin === null
      ? request.headers.get("sec-fetch-site")?.trim().toLowerCase() === "same-origin"
      : allowedOrigins(url, request, publicOrigin).includes(origin);
  if (!sameOrigin) return refusal(403, "cross_site");
  if (!isJson(request.headers.get("content-type"))) return refusal(415, "unsupported_media_type");
  return undefined;
};
