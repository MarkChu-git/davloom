/** Where `playwright.config.ts` starts `vite dev` for `dev-server.spec.ts`. */
export const DEV_SERVER_PORT = 4312;
/**
 * The browser reaches the dev server as localhost, the host of the `dev` project's Worker, so the
 * session cookie of that Worker reaches both.
 */
export const DEV_SERVER_ORIGIN = `http://localhost:${DEV_SERVER_PORT}`;
