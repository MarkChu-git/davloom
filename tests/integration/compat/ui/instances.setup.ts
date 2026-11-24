import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { expect, request as playwrightRequest, test as setup } from "@playwright/test";
import { ADMIN, DEV_WORKER_PORT, MOUNT, STATE, WORKERS_PORT, seedSample } from "./instances";

// Gives each Worker its owner through registration, the sample files in the Mount
// "files", and a signed-in browser state that the `workers` and `dev` projects start from.

const prepare = async (port: number, stateFile: string, cookieHost: string) => {
  const origin = `http://127.0.0.1:${port}`;
  const context = await playwrightRequest.newContext({ baseURL: origin });
  const status: unknown = await (await context.get("/api/registration")).json();
  if (typeof status === "object" && status !== null && Reflect.get(status, "open") === true) {
    const created = await context.post("/api/registration", { data: ADMIN });
    expect(created.status()).toBe(201);
  }
  const signIn = await context.post("/api/auth/sign-in/username", {
    headers: { origin },
    data: { username: ADMIN.username, password: ADMIN.password },
  });
  expect(signIn.ok()).toBe(true);
  // A Worker that a reused server keeps already holds the sample.
  const listing = await context.fetch(`/dav/${MOUNT}/README.txt`, {
    method: "HEAD",
    headers: { "x-davloom-dashboard": "1" },
  });
  if (listing.status() === 404) {
    await seedSample(context, `/${MOUNT}`);
  }
  const state = await context.storageState();
  // The browser reaches the `dev` project's Worker as localhost, and a cookie names its host.
  const cookies = state.cookies.map((cookie) => ({ ...cookie, domain: cookieHost }));
  await mkdir(dirname(stateFile), { recursive: true });
  await writeFile(stateFile, JSON.stringify({ ...state, cookies }));
  await context.dispose();
};

setup("Signed-in owners with sample files on both Workers", async () => {
  setup.setTimeout(120_000);
  await Promise.all([
    prepare(WORKERS_PORT, STATE.workers, "127.0.0.1"),
    prepare(DEV_WORKER_PORT, STATE.dev, "localhost"),
  ]);
});
