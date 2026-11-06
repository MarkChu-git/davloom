export const PROBE_TOKEN_HEADER = "x-davloom-probe-token";

type Handler = (request: Request) => Response | Promise<Response>;

/** A deployed probe is public, so it answers only with the run's token. Local runs set no token. */
export const guardWithToken =
  (token: string, handler: Handler): Handler =>
  (request) =>
    token !== "" && request.headers.get(PROBE_TOKEN_HEADER) !== token
      ? new Response(null, { status: 404 })
      : handler(request);
