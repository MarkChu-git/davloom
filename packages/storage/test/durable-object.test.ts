import { env } from "cloudflare:workers";
import type { StorageObject } from "../src/durable-object";
import { durableObjectSuite } from "./durable-object-suite";
import type { FullStorageObject } from "./worker";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly STORAGE: DurableObjectNamespace<StorageObject>;
      readonly FULL: DurableObjectNamespace<FullStorageObject>;
    }
  }
}

durableObjectSuite("workerd", { storage: env.STORAGE, full: env.FULL, runs: 40 });
