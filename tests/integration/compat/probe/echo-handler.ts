import type { WebDavHandler } from "@davloom/webdav";

/** Repeats the request it received, so tests can compare it with what the client sent. */
export const echoHandler: WebDavHandler = (request) => {
  const echo = JSON.stringify({
    method: request.method,
    path: new URL(request.url).pathname,
    headers: Object.fromEntries(request.headers),
  });
  return new Response(null, { status: 200, headers: { "x-probe-echo": echo } });
};
