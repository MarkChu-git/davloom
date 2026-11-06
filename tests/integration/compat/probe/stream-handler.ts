import { Elysia } from "elysia";

const RELEASE_LIMIT_MS = 15_000;
const RELEASE_POLL_MS = 10;
const DEFAULT_PART_BYTES = 64 * 1024;

const firstPartBytesByUpload = new Map<string, number>();
const releasedDownloads = new Set<string>();

/** Reads the body as it arrives and discards it, recording the size of the first part. */
export const readUpload = async (request: Request, id: string): Promise<Response> => {
  let bytes = 0;
  if (request.body) {
    const reader = request.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      if (bytes === 0) {
        firstPartBytesByUpload.set(id, value.byteLength);
      }
      bytes += value.byteLength;
    }
  }
  return Response.json({ bytes });
};

const untilReleased = async (id: string): Promise<void> => {
  const deadline = Date.now() + RELEASE_LIMIT_MS;
  while (!releasedDownloads.has(id)) {
    if (Date.now() > deadline) {
      throw new Error(`Download ${id} was never released`);
    }
    await new Promise((resolve) => setTimeout(resolve, RELEASE_POLL_MS));
  }
};

/** Writes one part, then holds the second part back until the client asks for it. */
export const startDownload = (request: Request, id: string): Response => {
  const partBytes = Number(
    new URL(request.url).searchParams.get("partBytes") ?? DEFAULT_PART_BYTES,
  );
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(partBytes).fill(1));
    },
    async pull(controller) {
      await untilReleased(id);
      controller.enqueue(new Uint8Array(partBytes).fill(2));
      controller.close();
    },
  });
  return new Response(body, { headers: { "content-type": "application/octet-stream" } });
};

/** Side channel for streaming tests: it shows a client what the handler has seen so far. */
export const streamRoutes = new Elysia({ name: "probe-stream" })
  .get("/api/__probe/stream/upload/:id", ({ params }) => ({
    firstPartBytes: firstPartBytesByUpload.get(params.id) ?? 0,
  }))
  .post("/api/__probe/stream/download/:id/release", ({ params }) => {
    releasedDownloads.add(params.id);
    return { released: true };
  });
