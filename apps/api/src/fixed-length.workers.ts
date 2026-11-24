import { fixesLength } from "@davloom/laws";

// workerd sends a body stream of unknown length chunked, and drops the Content-Length the WebDAV
// engine set, so a client downloading a file is never told its size. A FixedLengthStream tells
// workerd the length, and it sends the header. Only WebDAV answers go through it: they are never
// compressed, so the header counts the bytes the stream holds.

interface LengthStream {
  readonly readable: ReadableStream<Uint8Array>;
  readonly writable: WritableStream<Uint8Array>;
}

const isWebDav = (url: string) => /^\/dav(\/|$)/.test(new URL(url).pathname);

/** The response with its body in a stream of the length its Content-Length names. */
export const withFixedLength = (
  request: Request,
  response: Response,
  fixed: (length: number) => LengthStream = (length) => new FixedLengthStream(length),
): Response => {
  const header = response.headers.get("content-length");
  const length = header !== null && /^\d+$/.test(header) ? Number(header) : NaN;
  const fixes = fixesLength({
    hasBody: response.body !== null,
    hasHeader: header !== null,
    webdav: isWebDav(request.url),
    encoded: response.headers.has("content-encoding"),
    numeric: Number.isSafeInteger(length),
  });
  if (!fixes || response.body === null) return response;
  const stream = fixed(length);
  // A body that ends early or runs long errors the stream, so the client sees a broken transfer
  // rather than a file of the wrong size.
  void response.body.pipeTo(stream.writable).catch(() => undefined);
  return new Response(stream.readable, {
    status: response.status,
    statusText: response.statusText,
    headers: response.headers,
  });
};
