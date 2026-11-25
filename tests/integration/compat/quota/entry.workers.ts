import { withEnv } from "cloudflare:workers";
import production, {
  StorageObject as ProductionStorageObject,
} from "../../../../apps/api/src/entry.workers";
import {
  meteredD1,
  meteredFetch,
  meteredNamespace,
  meteredSql,
  readUsage,
  resetUsage,
} from "./meter.workers";
import { USAGE_PATH } from "./usage";

// The production Worker with metered bindings, for quota.test.ts: each request runs the production
// entry with D1, the storage namespace and fetch wrapped, and USAGE_PATH answers what the request
// before it cost. Nothing here changes what the Worker does or answers.

/** The production object, whose SQLite statements add their rows to the meter. */
export class StorageObject extends ProductionStorageObject {
  constructor(ctx: DurableObjectState, env: Cloudflare.Env) {
    super(ctx, env);
    // The object keeps its SQL handle in a private field; the metered one replaces it.
    Reflect.set(this, "sql", meteredSql(ctx.storage.sql));
  }
}

Reflect.set(globalThis, "fetch", meteredFetch(globalThis.fetch.bind(globalThis)));

const isResponse = (value: unknown): value is Response => value instanceof Response;

export default {
  fetch: async (request: Request, env: Cloudflare.Env): Promise<Response> => {
    if (new URL(request.url).pathname === USAGE_PATH) return Response.json(readUsage());
    resetUsage();
    const metered = { ...env, DB: meteredD1(env.DB), STORAGE: meteredNamespace(env.STORAGE) };
    const response: unknown = await withEnv(metered, () => production.fetch(request));
    if (!isResponse(response)) throw new Error("the production Worker answered no Response");
    return response;
  },
};
