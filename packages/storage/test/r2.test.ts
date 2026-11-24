import { env } from "cloudflare:workers";
import { r2Suite } from "./r2-suite";

declare global {
  namespace Cloudflare {
    interface Env {
      readonly R2: R2Bucket;
    }
  }
}

r2Suite("workerd", env.R2, 25);
