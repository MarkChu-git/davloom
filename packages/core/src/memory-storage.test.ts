import { describe, expect, it } from "vitest";
import { createMemoryStorage } from "./memory-storage";
import { storageContract } from "./testing/storage-contract";

storageContract("memory", { make: () => createMemoryStorage(), runs: 300 });

const stream = (text: string) => new Blob([text]).stream();

describe("memory storage limits", () => {
  it("refuses a file over its size limit, stated or not", async () => {
    const storage = createMemoryStorage({ maxFileSize: 3 });
    expect(await storage.write(["f"], stream("abcd"), { size: 4 })).toEqual({
      ok: false,
      failure: "too-large",
    });
    expect(await storage.write(["f"], stream("abcd"), {})).toEqual({
      ok: false,
      failure: "too-large",
    });
    expect((await storage.write(["f"], stream("abc"), {})).ok).toBe(true);
  });

  it("refuses writes and copies past its capacity", async () => {
    const storage = createMemoryStorage({ capacity: 4 });
    expect((await storage.write(["f"], stream("abc"), {})).ok).toBe(true);
    expect(await storage.write(["g"], stream("ab"), {})).toEqual({
      ok: false,
      failure: "insufficient-storage",
    });
    expect(await storage.copy(["f"], ["h"], { overwrite: false, shallow: false })).toEqual({
      ok: false,
      failure: "insufficient-storage",
    });
    // Replacing a file frees its old bytes first.
    expect((await storage.write(["f"], stream("abcd"), {})).ok).toBe(true);
  });

  it("decides again when the tree changed while the body arrived", async () => {
    const storage = createMemoryStorage();
    await storage.createCollection(["d"]);
    let release: (() => void) | undefined;
    const body = new ReadableStream<Uint8Array>({
      start: (controller) => {
        release = () => {
          controller.enqueue(new TextEncoder().encode("x"));
          controller.close();
        };
      },
    });
    const pending = storage.write(["d", "f"], body, {});
    await storage.remove(["d"]);
    release?.();
    expect(await pending).toEqual({ ok: false, failure: "no-parent" });
  });

  it("a failing body leaves nothing behind", async () => {
    const storage = createMemoryStorage();
    const body = new ReadableStream<Uint8Array>({
      pull: (controller) => controller.error(new Error("boom")),
    });
    expect(await storage.write(["f"], body, {})).toEqual({ ok: false, failure: "size-mismatch" });
    expect((await storage.stat(["f"])).ok).toBe(false);
  });

  it("uses the clock it is given", async () => {
    const storage = createMemoryStorage({ now: () => 42 });
    const written = await storage.write(["f"], null, {});
    expect(written.ok && written.value.entry.modified).toBe(42);
  });
});
