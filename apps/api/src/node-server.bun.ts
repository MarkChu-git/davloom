import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { planUrl, sendsMeasuredLength, type TargetForm } from "@davloom/laws";

// The self-hosted HTTP server: node:http on Bun, in front of the app's fetch handler. Bun.serve
// (Bun 1.4) drops the Content-Length of every answer whose body is a stream and sends it chunked,
// so a client downloading a file was never told its size, as on workerd before the Workers entry
// gave its bodies a FixedLengthStream. node:http sends the Content-Length that an answer carries
// and streams its body as it arrives, without holding a file in memory.

export type FetchHandler = (request: Request) => Response | Promise<Response>;

/** A body of up to this many bytes without a Content-Length is sent with one, as Bun.serve did. */
export const MEASURED_BODY_BYTES = 64 * 1024;

const BODILESS_METHODS = new Set(["GET", "HEAD"]);

/** Where a request goes when it names no usable host; never a loopback name. */
const NO_HOST = "http://host.invalid";

/** The path and query of an absolute-form target, or null when it is not one. */
const absolutePath = (target: string): string | null => {
  if (!URL.canParse(target)) return null;
  const absolute = new URL(target);
  return `${absolute.pathname}${absolute.search}`;
};

/**
 * The URL a node:http request names, as Bun.serve forms it from the request line and Host. An
 * absolute-form target names a scheme and a host of its own; Bun.serve kept only its path and
 * query, so a client cannot pass the HTTPS-only check or pick the origin by naming https:// or
 * localhost in the request line. The proven plan (laws url_host_from_header, url_path_exact) says
 * where the path and host come from.
 */
export const urlOf = (target: string, host: string | undefined): URL => {
  const absolute = target.startsWith("/") || target === "*" ? null : absolutePath(target);
  const form: TargetForm = target.startsWith("/")
    ? "origin"
    : target === "*"
      ? "asterisk"
      : absolute === null
        ? "invalid"
        : "absolute";
  const candidate = form === "origin" ? target : (absolute ?? "/");
  // A Host with a path, a query, credentials or spaces in it is not a host.
  const hostOk =
    host !== undefined &&
    host !== "" &&
    !/[/?#@\\\s]/.test(host) &&
    URL.canParse(`http://${host}${candidate}`);
  const plan = planUrl(form, hostOk);
  const path = plan.path === "target" ? target : plan.path === "absolute" ? candidate : "/";
  return new URL(plan.host === "header" ? `http://${host ?? ""}${path}` : `${NO_HOST}${path}`);
};

/** A request's body as a Web stream, read from the socket only as the handler asks. */
const bodyOf = (incoming: Readable): ReadableStream<Uint8Array> => {
  const chunks: AsyncIterator<unknown> = incoming[Symbol.asyncIterator]();
  return new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const next = await chunks.next();
        if (next.done) controller.close();
        else if (next.value instanceof Uint8Array) controller.enqueue(next.value);
        else controller.enqueue(new TextEncoder().encode(String(next.value)));
      },
      async cancel() {
        await chunks.return?.();
      },
    },
    { highWaterMark: 0 },
  );
};

/** The Web Request of a node:http request; aborted when the client goes away. */
export const toRequest = (incoming: IncomingMessage, signal: AbortSignal): Request => {
  const headers = new Headers();
  for (let index = 0; index + 1 < incoming.rawHeaders.length; index += 2) {
    const name = incoming.rawHeaders[index] ?? "";
    const value = incoming.rawHeaders[index + 1] ?? "";
    try {
      headers.append(name, value);
    } catch {
      // node:http accepts header values that a Web Headers object refuses; they are dropped.
    }
  }
  const method = incoming.method ?? "GET";
  const body = BODILESS_METHODS.has(method) ? undefined : bodyOf(incoming);
  return new Request(urlOf(incoming.url ?? "/", incoming.headers.host), {
    method,
    headers,
    body,
    signal,
    // @ts-expect-error -- `duplex` is required for a streamed body and missing from the DOM types.
    duplex: "half",
  });
};

const headersOf = (response: Response) => {
  const headers: Record<string, string | string[]> = {};
  response.headers.forEach((value, name) => {
    if (name !== "set-cookie") headers[name] = value;
  });
  const cookies = response.headers.getSetCookie();
  if (cookies.length > 0) headers["set-cookie"] = cookies;
  return headers;
};

/** Waits until the response can take more, or the client has gone. */
const drained = (outgoing: ServerResponse) =>
  new Promise<void>((done) => {
    const finish = () => {
      outgoing.off("drain", finish);
      outgoing.off("close", finish);
      done();
    };
    outgoing.once("drain", finish);
    outgoing.once("close", finish);
  });

/**
 * Writes a Web Response to a node:http response. A body with a Content-Length streams with that
 * header; a body without one is sent with the length it turns out to have when it ends within
 * MEASURED_BODY_BYTES, and chunked otherwise.
 */
export const writeResponse = async (
  response: Response,
  outgoing: ServerResponse,
  head: boolean,
): Promise<void> => {
  const headers = headersOf(response);
  if (head || response.body === null) {
    await response.body?.cancel().catch(() => undefined);
    outgoing.writeHead(response.status, headers);
    outgoing.end();
    return;
  }
  const reader = response.body.getReader();
  // node:http on Bun does not mark a response destroyed when its client goes away; close does.
  let gone = false;
  outgoing.once("close", () => {
    gone = !outgoing.writableFinished;
  });
  try {
    const first: Uint8Array[] = [];
    let measured = 0;
    let ended = false;
    if (response.headers.get("content-length") === null) {
      while (measured <= MEASURED_BODY_BYTES) {
        const next = await reader.read();
        if (next.done) {
          ended = true;
          break;
        }
        first.push(next.value);
        measured += next.value.byteLength;
      }
      // RFC 9110 gives a 1xx, 204 or 304 answer no Content-Length of a body it does not have.
      if (sendsMeasuredLength(false, ended, response.status)) {
        headers["content-length"] = String(measured);
      }
    }
    outgoing.writeHead(response.status, headers);
    for (const chunk of first) outgoing.write(chunk);
    for (
      let next = ended ? null : await reader.read();
      next && !next.done;
      next = await reader.read()
    ) {
      if (!gone && !outgoing.write(next.value)) await drained(outgoing);
      if (gone || outgoing.destroyed) {
        await reader.cancel().catch(() => undefined);
        return;
      }
    }
    outgoing.end();
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    // Once the status line is out, only a broken connection tells the client the body failed.
    if (outgoing.headersSent) outgoing.destroy(error instanceof Error ? error : undefined);
    else {
      outgoing.writeHead(500);
      outgoing.end();
    }
  }
};

export interface ListenOptions {
  readonly hostname: string;
  readonly port: number;
}

/** Serves `handle` over HTTP; resolves once it listens. */
export const serveNode = async (
  handle: FetchHandler,
  { hostname, port }: ListenOptions,
): Promise<{ readonly server: Server; readonly url: string }> => {
  const server = createServer((incoming, outgoing) => {
    const aborted = new AbortController();
    outgoing.once("close", () => {
      if (!outgoing.writableFinished) aborted.abort();
    });
    const answer = async () => {
      let response: Response;
      try {
        response = await handle(toRequest(incoming, aborted.signal));
      } catch (error) {
        console.error("the request handler failed", error);
        response = new Response(null, { status: 500 });
      }
      await writeResponse(response, outgoing, incoming.method === "HEAD");
    };
    void answer();
  });
  // Uploads of up to 5 GiB take longer than node:http's default limit on a whole request.
  server.requestTimeout = 0;
  await new Promise<void>((listening, failed) => {
    server.once("error", failed);
    server.listen(port, hostname, () => {
      server.off("error", failed);
      listening();
    });
  });
  const address = server.address();
  const bound = typeof address === "object" && address !== null ? address.port : port;
  const host = hostname.includes(":") ? `[${hostname}]` : hostname;
  return { server, url: `http://${host}:${bound}/` };
};
