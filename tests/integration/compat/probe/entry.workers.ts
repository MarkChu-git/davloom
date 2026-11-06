import { env } from "cloudflare:workers";
import type { Auth } from "@davloom/auth";
import { CloudflareAdapter } from "elysia/adapter/cloudflare-worker";
import { createProbeApp } from "./app";
import { createProbeAuth, type ProbeEnv } from "./auth.workers";
import { countD1Usage } from "./d1-usage.workers";
import { storeRoutes } from "./store-routes.workers";
import { guardWithToken } from "./token-guard";

export { ProbeStore } from "./store-object.workers";

const { AUTH_SECRET, DB, PROBE_TOKEN, STORE } = env as unknown as ProbeEnv;

const d1Usage = countD1Usage(DB);

let auth: Auth | undefined;
const getAuth = () => {
  auth ??= createProbeAuth(d1Usage.database, AUTH_SECRET);
  return auth;
};

const app = createProbeApp({ adapter: CloudflareAdapter, getAuth })
  .use(storeRoutes({ d1Usage, getAuth, store: STORE }))
  .compile();

export default {
  fetch: guardWithToken(PROBE_TOKEN, (request) => app.fetch(request)),
};
