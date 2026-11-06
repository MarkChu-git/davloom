import { Schema } from "effect";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { readJson } from "../shared/json";
import { startBunServer, type Server } from "./servers";

const MIB = 1024 * 1024;
const UPLOAD_BYTES = 1024 * MIB;
const CHUNK = new Uint8Array(MIB).fill(7);
const RSS_GROWTH_LIMIT_BYTES = 128 * MIB;

const Memory = Schema.Struct({ residentBytes: Schema.Number, peakResidentBytes: Schema.Number });
type Memory = typeof Memory.Type;

const oneGibibyteBody = () => {
  let sent = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (sent >= UPLOAD_BYTES) {
        controller.close();
        return;
      }
      controller.enqueue(CHUNK.slice());
      sent += CHUNK.byteLength;
    },
  });
};

describe("large upload on Bun", () => {
  let server: Server;

  const memory = async (): Promise<Memory> => {
    const response = await server.fetch("/api/__probe/memory");
    return readJson(response, Memory);
  };

  beforeAll(async () => {
    server = await startBunServer("tests/integration/compat/probe/entry.bun.ts");
  });
  afterAll(() => server?.stop());

  it(
    "takes 1 GiB with less than 128 MiB of resident memory growth",
    { timeout: 300_000 },
    async () => {
      // Warm the server up first, so that the baseline does not count code loaded by the first request.
      await server.fetch("/dav/__stream/upload/warm-up", { method: "PUT", body: CHUNK });
      const before = await memory();

      const response = await server.fetch("/dav/__stream/upload/one-gibibyte", {
        method: "PUT",
        body: oneGibibyteBody(),
        duplex: "half",
      } as RequestInit);
      const result = await response.json();
      const after = await memory();
      const growth = after.peakResidentBytes - before.residentBytes;

      console.info(
        `1 GiB upload on Bun: resident memory ${(before.residentBytes / MIB).toFixed(1)} MiB before, ` +
          `high-water mark ${(after.peakResidentBytes / MIB).toFixed(1)} MiB after, ` +
          `growth ${(growth / MIB).toFixed(1)} MiB`,
      );
      expect(response.status).toBe(200);
      expect(result).toEqual({ bytes: UPLOAD_BYTES });
      expect(growth).toBeLessThan(RSS_GROWTH_LIMIT_BYTES);
    },
  );
});
