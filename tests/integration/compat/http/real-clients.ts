import { spawnSync } from "node:child_process";
import { startWorkersServer, type Davloom } from "./davloom";
import { hasDocker, startSelfHostedServer } from "./selfhosted";
import type { Server } from "./servers";

// What the real-client tests share (PRD §11, real clients): the two deployments they run on, and
// checks of what the server holds, read over HTTP rather than through the client under test.

export const has = (command: string): boolean =>
  spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;

/** The deployments: the production Worker in local workerd, and Bun with SQLite and RustFS. */
export const DEPLOYMENTS: readonly [string, () => Promise<Server>, boolean][] = [
  ["Workers with D1 and Durable Objects", startWorkersServer, false],
  ["Bun with SQLite and RustFS", startSelfHostedServer, !hasDocker()],
];

/** The Mount that registration creates, which every real-client test works in. */
export const MOUNT = "files";

/** The /dav address of a path in the Mount, each name percent-encoded. */
export const davPathOf = (path: string): string =>
  `/${MOUNT}/${path
    .split("/")
    .filter((name) => name !== "")
    .map((name) => encodeURIComponent(name))
    .join("/")}`;

/** The body of a file in the Mount, or null when the server has none there. */
export const serverFile = async (davloom: Davloom, path: string): Promise<string | null> => {
  const response = await davloom.dav(davPathOf(path));
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200) throw new Error(`GET ${path}: ${response.status}`);
  return response.text();
};

/** The bytes of a file in the Mount, or null when the server has none there. */
export const serverBytes = async (davloom: Davloom, path: string): Promise<Uint8Array | null> => {
  const response = await davloom.dav(davPathOf(path));
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (response.status !== 200) throw new Error(`GET ${path}: ${response.status}`);
  return new Uint8Array(await response.arrayBuffer());
};

/** Whether the server has a collection at a path of the Mount. */
export const serverHasFolder = async (davloom: Davloom, path: string): Promise<boolean> => {
  const response = await davloom.dav(`${davPathOf(path)}/`, {
    method: "PROPFIND",
    headers: { depth: "0", "content-type": "application/xml" },
    body: '<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/></D:prop></D:propfind>',
  });
  const body = await response.text();
  return response.status === 207 && /<(\w+:)?collection\s*\/>/.test(body);
};

/** The lockdiscovery of a resource of the Mount, as the server reports it. */
export const serverLocks = async (davloom: Davloom, path: string): Promise<string> => {
  const response = await davloom.dav(davPathOf(path), {
    method: "PROPFIND",
    headers: { depth: "0", "content-type": "application/xml" },
    body: '<D:propfind xmlns:D="DAV:"><D:prop><D:lockdiscovery/></D:prop></D:propfind>',
  });
  if (response.status !== 207) throw new Error(`PROPFIND ${path}: ${response.status}`);
  const body = await response.text();
  return body.match(/<(\w+:)?lockdiscovery(\s*\/>|[\s\S]*?<\/(\w+:)?lockdiscovery>)/)?.[0] ?? "";
};

/** Stores a file in the Mount over HTTP, as another client would. */
export const putServerFile = async (
  davloom: Davloom,
  path: string,
  body: string | Uint8Array<ArrayBuffer>,
): Promise<number> => {
  const response = await davloom.dav(davPathOf(path), { method: "PUT", body });
  await response.body?.cancel();
  return response.status;
};

/** Makes a collection in the Mount over HTTP. */
export const mkcolServer = async (davloom: Davloom, path: string): Promise<void> => {
  const response = await davloom.dav(`${davPathOf(path)}/`, { method: "MKCOL" });
  await response.body?.cancel();
  if (response.status !== 201) throw new Error(`MKCOL ${path}: ${response.status}`);
};

/** Waits until `check` holds, for what a client sends in the background. */
export const eventually = async (
  check: () => Promise<boolean>,
  what: string,
  timeoutMs = 20_000,
): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await check()) return;
    await new Promise((done) => setTimeout(done, 200));
  }
  throw new Error(`${what} did not happen within ${timeoutMs / 1000} s`);
};
