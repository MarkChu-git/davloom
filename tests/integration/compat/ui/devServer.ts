/** Where `playwright.config.ts` starts `vite dev` for `dev-server.spec.ts`. */
export const DEV_SERVER_PORT = (Number(process.env.DAVLOOM_UI_PORT_BASE ?? "") || 4310) + 2;
/**
 * The browser reaches the dev server as localhost, the host of the `dev` project's Worker, so the
 * session cookie of that Worker reaches both.
 */
export const DEV_SERVER_ORIGIN = `http://localhost:${DEV_SERVER_PORT}`;
