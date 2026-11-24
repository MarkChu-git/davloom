import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADMIN, SECRET, SETUP_TOKEN, startDavloom, stringField, type Davloom } from "./davloom";
import { hasDocker, SECRET_KEY, startSelfHostedServer } from "./selfhosted";
import { startBunServer, startWorkerdServer, type Server } from "./servers";

// Log redaction (PRD §11 security layer, §12 "Do not log sensitive authentication content"): each
// deployment gets requests that carry every kind of secret Davloom handles, in the places a client
// puts them, on paths that succeed and paths that fail, and none of the secrets may appear in
// anything the server logs. A Bun server's log is its standard output and error; the Worker's is
// what it logs in local workerd, and what Miniflare logs about its requests.

/** Secrets that only this file sends, each easy to find in a log. */
const CANARY = {
  wrongKey: "dav_wrong-api-key-canary-for-the-redaction-test",
  wrongPassword: "wrong-password-canary-5e1f9a",
  setupPassword: "setup-password-canary-8b2c7d",
  setupToken: "setup-token-canary-3d9e4f",
  importKey: "import-key-canary-6a7b8c9d",
  bearer: "bearer-token-canary-1f2e3d4c",
  forgedSession: "forged-session-canary-9z8y7x.c2lnbmF0dXJl",
  s3Secret: "s3-secret-access-key-canary-2B4D6F8H",
  newPassword: "new-admin-password-canary-0K2M4O",
} as const;

const DEPLOYMENTS: readonly [string, () => Promise<Server>, boolean][] = [
  [
    "Workers with D1 and Durable Objects",
    () =>
      startWorkerdServer("apps/api/wrangler.jsonc", {
        vars: { DAVLOOM_SECRET: SECRET, DAVLOOM_SETUP_TOKEN: SETUP_TOKEN },
        keepLogs: true,
      }),
    false,
  ],
  [
    "Bun with SQLite",
    async () => {
      const dataDir = mkdtempSync(join(tmpdir(), "davloom-redaction-"));
      const server = await startBunServer("apps/api/src/entry.bun.ts", {
        DAVLOOM_SECRET: SECRET,
        DAVLOOM_SETUP_TOKEN: SETUP_TOKEN,
        DAVLOOM_DATA_DIR: dataDir,
      });
      return {
        ...server,
        stop: async () => {
          await server.stop();
          rmSync(dataDir, { recursive: true, force: true });
        },
      };
    },
    false,
  ],
  ["Bun with SQLite and RustFS", startSelfHostedServer, !hasDocker()],
];

const json = (value: unknown) => JSON.stringify(value);

const PROPFIND = '<D:propfind xmlns:D="DAV:"><D:allprop/></D:propfind>';
const LOCK =
  '<D:lockinfo xmlns:D="DAV:"><D:lockscope><D:exclusive/></D:lockscope><D:locktype><D:write/></D:locktype><D:owner>redaction</D:owner></D:lockinfo>';

/** Sends a request and reads its whole answer, so that the server has finished with it. */
const settle = async (response: Promise<Response>): Promise<number> => {
  const answer = await response;
  await answer.arrayBuffer();
  return answer.status;
};

/**
 * Every request the redaction check covers. It returns the secrets that only the server knew
 * before it answered: the export key.
 */
const drive = async ({ server, dav, api, readOnlyKey }: Davloom): Promise<string[]> => {
  // WebDAV with the Read / Write key, on paths that succeed.
  await settle(dav("/files/redaction/", { method: "MKCOL" }));
  await settle(dav("/files/redaction/a.txt", { method: "PUT", body: "a" }));
  await settle(dav("/files/redaction/a.txt"));
  await settle(
    dav("/files/redaction/", { method: "PROPFIND", headers: { depth: "1" }, body: PROPFIND }),
  );
  await settle(
    dav("/files/redaction/a.txt", {
      method: "COPY",
      headers: { destination: `${server.url}/dav/files/redaction/b.txt` },
    }),
  );
  await settle(
    dav("/files/redaction/b.txt", {
      method: "MOVE",
      headers: { destination: `${server.url}/dav/files/redaction/c.txt` },
    }),
  );
  const locked = await dav("/files/redaction/c.txt", { method: "LOCK", body: LOCK });
  await locked.arrayBuffer();
  const token = locked.headers.get("lock-token") ?? "";
  await settle(
    dav("/files/redaction/c.txt", { method: "UNLOCK", headers: { "lock-token": token } }),
  );
  await settle(dav("/files/redaction/c.txt", { method: "DELETE" }));
  // ... and on paths that fail: a body that is not XML, a path that climbs out, a missing file.
  await settle(dav("/files/redaction/", { method: "PROPFIND", body: "<not xml" }));
  await settle(dav("/files/redaction/%2e%2e/%2e%2e/etc/passwd"));
  await settle(dav("/files/redaction/missing.txt"));
  // The Read Only key, refused a write.
  await settle(dav("/files/redaction/ro.txt", { method: "PUT", body: "x", key: readOnlyKey }));
  // Credentials that are wrong, malformed or of another kind.
  await settle(dav("/files/", { method: "PROPFIND", key: CANARY.wrongKey }));
  await settle(
    server.fetch("/dav/files/", {
      method: "PROPFIND",
      headers: { authorization: `Basic ${btoa(`${CANARY.wrongKey}:${CANARY.wrongPassword}`)}` },
    }),
  );
  await settle(
    server.fetch("/dav/files/", { headers: { authorization: `Basic ${CANARY.wrongKey}!!` } }),
  );
  await settle(
    server.fetch("/dav/files/", { headers: { authorization: `Bearer ${CANARY.bearer}` } }),
  );
  await settle(server.fetch("/api/me", { headers: { authorization: `Bearer ${CANARY.bearer}` } }));
  await settle(
    server.fetch("/api/me", {
      headers: { cookie: `better-auth.session_token=${CANARY.forgedSession}` },
    }),
  );
  await settle(
    server.fetch("/dav/files/", {
      method: "PROPFIND",
      headers: { cookie: `better-auth.session_token=${CANARY.forgedSession}` },
    }),
  );
  // Passwords and tokens in bodies: sign-in with a wrong and a right password, setup and import
  // after setup, and a body that is not JSON around a password.
  const signIn = (password: string) =>
    settle(
      server.fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "content-type": "application/json", origin: server.url },
        body: json({ email: ADMIN.email, password }),
      }),
    );
  await signIn(CANARY.wrongPassword);
  await signIn(ADMIN.password);
  await settle(
    server.fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json({ ...ADMIN, password: CANARY.setupPassword, token: CANARY.setupToken }),
    }),
  );
  await settle(
    server.fetch("/api/setup", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: `{"password":"${CANARY.setupPassword}","token":"${CANARY.setupToken}"`,
    }),
  );
  await settle(
    server.fetch("/api/setup/import", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: json({ token: CANARY.setupToken, key: CANARY.importKey, file: { version: 1 } }),
    }),
  );
  // The session cookie on the management API.
  await settle(api("/api/me"));
  await settle(api("/api/keys"));
  await settle(api("/api/overview"));
  const exported = await api("/api/export", { method: "POST" });
  const exportKey = exported.status === 200 ? stringField(await exported.json(), "key") : "";
  // An S3 secret: a backend whose endpoint answers nothing, so every call to it fails and logs.
  const backend = await api("/api/backends", {
    method: "POST",
    body: json({
      name: "Redaction",
      kind: "s3",
      config: {
        endpoint: "http://127.0.0.1:9",
        region: "us-east-1",
        bucket: "redaction",
        forcePathStyle: true,
        accessKeyId: "redaction",
      },
      secretKey: CANARY.s3Secret,
    }),
  });
  if (backend.status !== 201) throw new Error(`backend: ${backend.status} ${await backend.text()}`);
  const backendId = stringField(await backend.json(), "id");
  const mount = await api("/api/mounts", {
    method: "POST",
    body: json({ name: "redaction", backendId, root: "" }),
  });
  if (mount.status !== 201) throw new Error(`mount: ${mount.status} ${await mount.text()}`);
  await settle(dav("/redaction/", { method: "PROPFIND", headers: { depth: "1" } }));
  await settle(dav("/redaction/f.txt", { method: "PUT", body: "f" }));
  await settle(dav("/redaction/f.txt"));
  await settle(api("/api/backends"));
  await settle(api("/api/overview"));
  // A new password, last, since it changes the administrator's.
  await settle(
    api("/api/auth/change-password", {
      method: "POST",
      body: json({ currentPassword: ADMIN.password, newPassword: CANARY.newPassword }),
    }),
  );
  await signIn(CANARY.newPassword);
  return exportKey === "" ? [] : [exportKey];
};

/** The forms a secret takes on its way: as it is, in Basic Auth, in Base64 and percent-encoded. */
const formsOf = (secret: string): string[] => [
  secret,
  btoa(`davloom:${secret}`),
  btoa(secret).replace(/=+$/, ""),
  encodeURIComponent(secret),
];

/** The value of each cookie in a Cookie header, such as the session token and its signature. */
const cookieValues = (cookie: string): string[] =>
  cookie
    .split(";")
    .map((pair) => decodeURIComponent(pair.split("=").slice(1).join("=").trim()))
    .flatMap((value) => [value, ...value.split(".")])
    .filter((value) => value.length >= 16);

describe.each(DEPLOYMENTS)("logs of %s", (name, start, skip) => {
  let davloom: Davloom;
  let logs = "";
  let secrets: [string, string][] = [];

  beforeAll(async () => {
    if (skip) return;
    davloom = await startDavloom(start);
    const issued = await drive(davloom);
    // A moment for the last log lines to reach the pipe.
    await new Promise((done) => setTimeout(done, 500));
    logs = davloom.server.logs?.() ?? "";
    secrets = [
      ["the instance secret", SECRET],
      ["the setup token", SETUP_TOKEN],
      ["the administrator's password", ADMIN.password],
      ["the Read / Write API Key", davloom.readWriteKey],
      ["the Read Only API Key", davloom.readOnlyKey],
      ...cookieValues(davloom.cookie).map(
        (value, index) => [`session cookie part ${index + 1}`, value] as [string, string],
      ),
      ...Object.entries(CANARY).map(
        ([what, value]) => [`the ${what} sent`, value] as [string, string],
      ),
      ...issued.map((value) => ["the export key", value] as [string, string]),
      ...(name.includes("RustFS") ? [["RustFS's secret key", SECRET_KEY] as [string, string]] : []),
    ];
  }, 240_000);
  afterAll(async () => {
    await davloom?.server.stop();
  });

  describe.skipIf(skip)("after requests with every kind of secret", () => {
    it("the server keeps a log, which shows the S3 calls that failed", () => {
      expect(davloom.server.logs).toBeDefined();
      expect(logs).toContain("S3 request failed");
    });

    it("the checks cover the session cookie and the export key", () => {
      expect(secrets.some(([what]) => what.startsWith("session cookie"))).toBe(true);
      expect(secrets.some(([what]) => what === "the export key")).toBe(true);
    });

    it("no log line holds a secret, in any form", () => {
      const found = secrets.flatMap(([what, value]) =>
        formsOf(value)
          .filter((form) => logs.includes(form))
          .map((form) => `${what} as ${form}`),
      );
      expect(found).toEqual([]);
    });

    it.each(Object.entries(CANARY))("the %s sent never appears", (_what, value) => {
      for (const form of formsOf(value)) expect(logs).not.toContain(form);
    });
  });
});
