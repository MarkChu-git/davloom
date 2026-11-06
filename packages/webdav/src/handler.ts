/** The WebDAV entry point. It depends on nothing but Web standard types, so it can run anywhere. */
export type WebDavHandler = (request: Request) => Response | Promise<Response>;

/** Answers every request until protocol behaviour exists, and advertises no DAV capability. */
export const notImplementedHandler: WebDavHandler = () => new Response(null, { status: 501 });
