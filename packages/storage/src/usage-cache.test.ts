import { createMemoryStorage, ok, type StorageBackend } from "@davloom/core";
import { describe, expect, it } from "vitest";
import {
  createUsageStore,
  USAGE_MAX_AGE_AFTER_CHANGE_MS,
  USAGE_MAX_AGE_MS,
  withUsageCache,
} from "./usage-cache";

const streamOf = (text: string) => new Blob([text]).stream();

/** A memory backend that counts how often its usage was counted. */
const counting = () => {
  const inner = createMemoryStorage();
  const state = { counts: 0, failing: false };
  const backend: StorageBackend = {
    ...inner,
    usage: async () => {
      state.counts += 1;
      return state.failing ? { ok: false, failure: "unavailable" } : await inner.usage();
    },
  };
  return { inner, backend, state };
};

const setup = () => {
  const clock = { now: 1_000_000 };
  const store = createUsageStore();
  const { inner, backend, state } = counting();
  const open = (key = "b") => withUsageCache(backend, { key, store, now: () => clock.now });
  return { clock, store, inner, state, open };
};

describe("withUsageCache", () => {
  it("counts once, then answers from the count with its time until it is too old", async () => {
    const { clock, state, inner, open } = setup();
    await inner.write(["f"], streamOf("abc"), {});
    const cached = open();
    const first = await cached.usage();
    expect(first).toEqual(ok({ files: 1, collections: 0, bytes: 3, measuredAt: 1_000_000 }));
    clock.now += USAGE_MAX_AGE_MS - 1;
    // A change made outside Davloom shows only once the usage is counted again.
    await inner.write(["g"], streamOf("de"), {});
    expect(await open().usage()).toEqual(first);
    expect(state.counts).toBe(1);
    clock.now += 1;
    expect(await cached.usage()).toEqual(
      ok({ files: 2, collections: 0, bytes: 5, measuredAt: clock.now }),
    );
    expect(state.counts).toBe(2);
  });

  it.each([
    ["write", (b: StorageBackend) => b.write(["n"], streamOf("x"), {})],
    ["createCollection", (b: StorageBackend) => b.createCollection(["d"])],
    ["remove", (b: StorageBackend) => b.remove(["f"])],
    ["copy", (b: StorageBackend) => b.copy(["f"], ["c"], { overwrite: false, shallow: false })],
    ["move", (b: StorageBackend) => b.move(["f"], ["m"], { overwrite: false })],
  ])("counts again a minute after a %s through Davloom", async (_, change) => {
    const { clock, state, inner, open } = setup();
    await inner.write(["f"], streamOf("abc"), {});
    const cached = open();
    await cached.usage();
    await change(open());
    clock.now += USAGE_MAX_AGE_AFTER_CHANGE_MS - 1;
    await cached.usage();
    expect(state.counts).toBe(1);
    clock.now += 1;
    const after = await cached.usage();
    expect(state.counts).toBe(2);
    const current = await inner.usage();
    expect(after).toEqual(current.ok ? ok({ ...current.value, measuredAt: clock.now }) : current);
  });

  it("does not change what a read, a listing or a property answers", async () => {
    const { clock, state, inner, open } = setup();
    await inner.write(["f"], streamOf("abc"), {});
    const cached = open();
    await cached.usage();
    await cached.stat(["f"]);
    await cached.list([]);
    await cached.patchProperties(["f"], [{ name: "{urn:t}p", xml: "<p xmlns='urn:t'/>" }], []);
    clock.now += USAGE_MAX_AGE_AFTER_CHANGE_MS;
    await cached.usage();
    expect(state.counts).toBe(1);
  });

  it("counts a change made while the count ran as a change", async () => {
    const { clock, state, open } = setup();
    const cached = open();
    const first = cached.usage();
    await cached.write(["f"], streamOf("abc"), {});
    await first;
    clock.now += USAGE_MAX_AGE_AFTER_CHANGE_MS;
    expect(await cached.usage()).toMatchObject({ ok: true, value: { files: 1 } });
    expect(state.counts).toBe(2);
  });

  it("shares one count among callers that ask at once", async () => {
    const { state, open } = setup();
    const results = await Promise.all([open().usage(), open().usage(), open().usage()]);
    expect(state.counts).toBe(1);
    expect(new Set(results.map((r) => JSON.stringify(r))).size).toBe(1);
  });

  it("keeps no failure, and keeps backends and settings apart", async () => {
    const { state, open } = setup();
    state.failing = true;
    expect(await open().usage()).toEqual({ ok: false, failure: "unavailable" });
    state.failing = false;
    expect((await open().usage()).ok).toBe(true);
    await open("other").usage();
    expect(state.counts).toBe(3);
  });

  it("forgets the count when the backend is released", async () => {
    const { store, state, open } = setup();
    await open().usage();
    expect(await open().release?.()).toEqual(ok(null));
    expect(store.has("b")).toBe(false);
    await open().usage();
    expect(state.counts).toBe(2);
  });

  it("releases a backend that keeps nothing outside its records", async () => {
    const backend: StorageBackend = { ...createMemoryStorage(), release: undefined };
    const cached = withUsageCache(backend, { key: "x", store: createUsageStore() });
    expect(await cached.release?.()).toEqual(ok(null));
  });
});
