import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { probeRuntimes, type Server } from "./servers";

const PART_BYTES = 64 * 1024;
const part = (fill: number) => new Uint8Array(PART_BYTES).fill(fill);
const WAIT_LIMIT_MS = 10_000;

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Rejects when `promise` takes too long, so a buffering server fails instead of hanging the test. */
const withinLimit = <T>(promise: Promise<T>, what: string): Promise<T> =>
  Promise.race([
    promise,
    pause(WAIT_LIMIT_MS).then(() => {
      throw new Error(`Timed out waiting for ${what}`);
    }),
  ]);

const untilFirstPartArrives = async (server: Server, id: string) => {
  for (;;) {
    const response = await server.fetch(`/api/__probe/stream/upload/${id}`);
    const { firstPartBytes } = (await response.json()) as { firstPartBytes: number };
    if (firstPartBytes > 0) {
      return firstPartBytes;
    }
    await pause(20);
  }
};

describe.each(probeRuntimes)("streaming on $name", ({ start }) => {
  let server: Server;

  beforeAll(async () => {
    server = await start();
  });
  afterAll(() => server?.stop());

  it("the handler gets the first part of an upload before the client sends the next", async () => {
    const id = crypto.randomUUID();
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const upload = server.fetch(`/dav/__stream/upload/${id}`, {
      method: "PUT",
      body: readable,
      duplex: "half",
    } as RequestInit);

    await writer.write(part(1));
    const firstPartBytes = await withinLimit(untilFirstPartArrives(server, id), "the first part");
    await writer.write(part(2));
    await writer.close();
    const response = await withinLimit(upload, "the upload response");

    expect(firstPartBytes).toBeGreaterThan(0);
    expect(firstPartBytes).toBeLessThanOrEqual(PART_BYTES);
    expect(await response.json()).toEqual({ bytes: PART_BYTES * 2 });
  });

  it("the client gets the first part of a download before the handler writes the next", async () => {
    const id = crypto.randomUUID();
    const response = await withinLimit(
      server.fetch(`/dav/__stream/download/${id}?partBytes=${PART_BYTES}`),
      "the download response",
    );
    const reader = (response.body as ReadableStream<Uint8Array>).getReader();

    const first = await withinLimit(reader.read(), "the first part");
    expect(first.done).toBe(false);
    expect(first.value?.[0]).toBe(1);

    let received = first.value?.byteLength ?? 0;
    await server.fetch(`/api/__probe/stream/download/${id}/release`, { method: "POST" });
    for (;;) {
      const { done, value } = await withinLimit(reader.read(), "the rest of the download");
      if (done) {
        break;
      }
      received += value.byteLength;
    }

    expect(received).toBe(PART_BYTES * 2);
  });
});
