import { createApp, type AppOptions } from "@davloom/api/app";
import type { Auth } from "@davloom/auth";
import { effectRoutes } from "./effect-routes";
import { probeHandler } from "./handler";
import { identityRoutes } from "./identity-routes";
import { streamRoutes } from "./stream-handler";

export interface ProbeOptions extends AppOptions {
  /** Called on demand: Workers build this while handling the first request that needs it. */
  readonly getAuth: () => Auth;
}

/** The production app plus the routes that only compatibility tests may reach. */
export const createProbeApp = ({ getAuth, ...options }: ProbeOptions) =>
  createApp({
    ...options,
    webdavHandler: probeHandler,
    // The probe's routes guard themselves (token-guard.ts) and take no session.
    classify: (_method, route) => (route.startsWith("/api/__probe/") ? "public" : undefined),
    // They take the probe token, not a session cookie, so a page elsewhere cannot ride on them.
    sameOriginExempt: (pathname) => pathname.startsWith("/api/__probe/"),
  })
    .use(effectRoutes)
    .use(streamRoutes)
    .use(identityRoutes(getAuth));
