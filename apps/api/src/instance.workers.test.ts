import { env } from "cloudflare:workers";
import { InstanceConfig, StorageOpener, type BackendRecord } from "@davloom/core";
import { Effect } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { workersInstance } from "./instance.workers";

// The Workers instance's wiring, with `cloudflare:workers` replaced by a stand-in whose bindings
// each test sets. The bindings themselves run in workerd (tests/integration/compat).

// The stand-in exports its bindings as a plain object; the real module types them as Env.
const bindings: Record<string, unknown> = Object(env);
const SECRET = "w".repeat(32);

const namespace = { idFromName: (name: string) => ({ name }), get: () => ({}) };
/** An object that reports itself as an R2 bucket, as the binding's own class does. */
const bucket = () => ({ [Symbol.toStringTag]: "R2Bucket" });

const setBindings = (values: Record<string, unknown>) => {
  for (const name of Object.keys(bindings)) delete bindings[name];
  Object.assign(bindings, { DB: {}, STORAGE: namespace, ...values });
};
afterEach(() => setBindings({}));

const backend = (kind: string, config: unknown = {}): BackendRecord => ({
  id: "b-1",
  name: "B",
  kind,
  config,
  secretKey: null,
  createdAt: new Date(0),
});

const services = (instance: ReturnType<typeof workersInstance>) =>
  Effect.runPromise(
    Effect.provide(Effect.all({ opener: StorageOpener, config: InstanceConfig }), instance.layer),
  );

describe("workersInstance", () => {
  it("refuses an instance secret shorter than 32 bytes", () => {
    setBindings({ DAVLOOM_SECRET: "short" });
    expect(() => workersInstance("https://x.test")).toThrow("DAVLOOM_SECRET must be set");
    setBindings({});
    expect(() => workersInstance("https://x.test")).toThrow("DAVLOOM_SECRET must be set");
  });

  it("offers Durable Objects and S3, opens them, and nothing it does not know", async () => {
    setBindings({ DAVLOOM_SECRET: SECRET, DAVLOOM_SETUP_TOKEN: " token " });
    const { opener, config } = await services(workersInstance("https://x.test"));
    expect(config).toMatchObject({ setupToken: "token", storageKinds: ["durable-object", "s3"] });
    expect(opener.open(backend("durable-object"))).not.toBeNull();
    expect(opener.open(backend("r2", { binding: "FILES" }))).toBeNull();
    expect(opener.open(backend("memory"))).toBeNull();
    expect(
      opener.open(
        backend("s3", {
          endpoint: "https://s3.test",
          region: "auto",
          bucket: "b",
          forcePathStyle: true,
          accessKeyId: "id",
        }),
      ),
    ).not.toBeNull();
  });

  it("offers R2 where the deployment has an R2 binding, and opens backends of it", async () => {
    setBindings({ DAVLOOM_SECRET: SECRET, FILES: bucket(), NOT_A_BUCKET: { get: () => null } });
    const { opener, config } = await services(workersInstance("https://x.test"));
    expect(config).toMatchObject({
      setupToken: null,
      storageKinds: ["durable-object", "s3", "r2"],
    });
    expect(opener.open(backend("r2", { binding: "FILES" }))).not.toBeNull();
    expect(opener.open(backend("r2", { binding: "NOT_A_BUCKET" }))).toBeNull();
    expect(opener.open(backend("r2", { binding: 7 }))).toBeNull();
  });
});
