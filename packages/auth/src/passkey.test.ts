// The test runs on Bun SQLite, so it needs Bun's types; the package itself keeps `types: []`.
/// <reference types="bun" />
import { Database } from "bun:sqlite";
import { createBunSqliteDatabase, migrateBunSqliteDatabase } from "@davloom/database/bun-sqlite";
import * as schema from "@davloom/database/schema";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createAuth } from "./auth";
import { createIdentity } from "./identity";
import { cookieHeader } from "./testing";

// Signing in with a passkey over HTTP, with a software authenticator: an ES256 key whose public
// half is stored as the owner's passkey, and assertions signed as a browser's authenticator signs
// them (WebAuthn §6.3.3). A passkey sign-in that a step-up starts replaces the browser's earlier
// session of the same owner (auth.ts).

const ORIGIN = "https://files.example.com";
const RP_ID = "files.example.com";
const OWNER = {
  username: "ada",
  name: "Ada",
  email: null,
  password: "a long password nobody has used",
};

const base64url = (bytes: Uint8Array): string => Buffer.from(bytes).toString("base64url");

const sha256 = async (bytes: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> =>
  new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));

const concat = (...parts: readonly Uint8Array[]): Uint8Array<ArrayBuffer> => {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let at = 0;
  for (const part of parts) {
    out.set(part, at);
    at += part.length;
  }
  return out;
};

/** One unsigned integer of an ASN.1 DER SEQUENCE: no leading zeros, and a 0 before a high bit. */
const derInteger = (raw: Uint8Array): Uint8Array => {
  let start = 0;
  while (start < raw.length - 1 && raw[start] === 0) start += 1;
  const trimmed = raw.slice(start);
  const value = (trimmed[0] ?? 0) & 0x80 ? concat(new Uint8Array([0]), trimmed) : trimmed;
  return concat(new Uint8Array([0x02, value.length]), value);
};

/** WebCrypto's raw r || s ECDSA signature as the DER that WebAuthn authenticators return. */
const derSignature = (raw: Uint8Array): Uint8Array => {
  const body = concat(derInteger(raw.slice(0, 32)), derInteger(raw.slice(32)));
  return concat(new Uint8Array([0x30, body.length]), body);
};

/** A P-256 public key as a COSE_Key map (RFC 9053): kty EC2, alg ES256, crv P-256, x, y. */
const coseKey = (x: Uint8Array, y: Uint8Array): Uint8Array =>
  concat(
    new Uint8Array([0xa5, 0x01, 0x02, 0x03, 0x26, 0x20, 0x01, 0x21, 0x58, 0x20]),
    x,
    new Uint8Array([0x22, 0x58, 0x20]),
    y,
  );

const authenticator = async () => {
  const keys = await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
    "sign",
    "verify",
  ]);
  const jwk = await crypto.subtle.exportKey("jwk", keys.publicKey);
  const x = Buffer.from(jwk.x ?? "", "base64url");
  const y = Buffer.from(jwk.y ?? "", "base64url");
  const credentialId = base64url(crypto.getRandomValues(new Uint8Array(16)));
  let counter = 0;
  return {
    credentialId,
    publicKey: Buffer.from(coseKey(x, y)).toString("base64"),
    /** The assertion for a challenge, signed with this key, or with another when `forged`. */
    assert: async (challenge: string, forged = false) => {
      counter += 1;
      const clientDataJSON = new TextEncoder().encode(
        JSON.stringify({ type: "webauthn.get", challenge, origin: ORIGIN, crossOrigin: false }),
      );
      const flags = 0x05; // user present, user verified
      const authenticatorData = concat(
        await sha256(new TextEncoder().encode(RP_ID)),
        new Uint8Array([flags, 0, 0, 0, counter]),
      );
      const signer = forged
        ? (
            await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, [
              "sign",
              "verify",
            ])
          ).privateKey
        : keys.privateKey;
      const raw = new Uint8Array(
        await crypto.subtle.sign(
          { name: "ECDSA", hash: "SHA-256" },
          signer,
          concat(authenticatorData, await sha256(clientDataJSON)),
        ),
      );
      return {
        id: credentialId,
        rawId: credentialId,
        type: "public-key",
        clientExtensionResults: {},
        response: {
          authenticatorData: base64url(authenticatorData),
          clientDataJSON: base64url(clientDataJSON),
          signature: base64url(derSignature(raw)),
        },
      };
    },
  };
};

let db: ReturnType<typeof createBunSqliteDatabase>;
let auth: ReturnType<typeof createAuth>;
let key: Awaited<ReturnType<typeof authenticator>>;

beforeEach(async () => {
  db = createBunSqliteDatabase(new Database(":memory:"));
  migrateBunSqliteDatabase(db);
  auth = createAuth({
    database: db,
    secret: "a-test-secret-that-is-at-least-32-characters",
    baseURL: "http://localhost",
    checkLeakedPasswords: false,
    rateLimit: false,
    passkeyOrigin: ORIGIN,
  });
  const registered = await createIdentity(auth).registerOwner(OWNER);
  if (!registered.ok) throw new Error("registration failed");
  key = await authenticator();
  await db.insert(schema.passkey).values({
    id: "pk1",
    name: "Test key",
    publicKey: key.publicKey,
    userId: registered.id,
    credentialID: key.credentialId,
    counter: 0,
    deviceType: "singleDevice",
    backedUp: false,
    transports: "internal",
    createdAt: new Date(),
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** Joins the Cookie headers of several answers, a later cookie replacing an earlier one. */
const cookies = (...headers: readonly string[]): string => {
  const jar = new Map<string, string>();
  for (const header of headers) {
    for (const pair of header.split("; ").filter((item) => item !== "")) {
      jar.set(pair.split("=")[0] ?? "", pair);
    }
  }
  return [...jar.values()].join("; ");
};

const http = (path: string, init: { body?: unknown; cookie?: string } = {}) => {
  const headers = new Headers({ origin: ORIGIN });
  if (init.cookie !== undefined && init.cookie !== "") headers.set("cookie", init.cookie);
  if (init.body !== undefined) headers.set("content-type", "application/json");
  return auth.handler(
    new Request(`${ORIGIN}/api/auth${path}`, {
      method: init.body === undefined ? "GET" : "POST",
      headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    }),
  );
};

const passwordSession = async (): Promise<string> => {
  const response = await http("/sign-in/username", {
    body: { username: OWNER.username, password: OWNER.password },
  });
  expect(response.status).toBe(200);
  return cookieHeader(response);
};

/** A passkey sign-in from a browser that holds `cookie`; the answer, and the cookies after it. */
const passkeySignIn = async (cookie = "", forged = false) => {
  const options = await http("/passkey/generate-authenticate-options", { cookie });
  expect(options.status).toBe(200);
  const body: unknown = await options.json();
  const challenge: unknown = Reflect.get(Object(body), "challenge");
  if (typeof challenge !== "string") throw new Error("no challenge");
  const withChallenge = cookies(cookie, cookieHeader(options));
  const response = await http("/passkey/verify-authentication", {
    cookie: withChallenge,
    body: { response: await key.assert(challenge, forged) },
  });
  return { response, cookie: cookies(withChallenge, cookieHeader(response)) };
};

const sessionTokens = async () =>
  (await db.select({ token: schema.session.token }).from(schema.session)).map((row) => row.token);

const tokenOf = (cookie: string): string | undefined =>
  /better-auth\.session_token=([^.;]+)/.exec(cookie)?.[1];

describe("signing in with a passkey", () => {
  it("starts a session for a browser without one", async () => {
    const { response, cookie } = await passkeySignIn();
    expect(response.status).toBe(200);
    expect(await sessionTokens()).toEqual([tokenOf(cookie)]);
  });

  it("replaces the browser's earlier session of the same owner", async () => {
    const earlier = await passwordSession();
    expect(await sessionTokens()).toEqual([tokenOf(earlier)]);
    const { response, cookie } = await passkeySignIn(earlier);
    expect(response.status).toBe(200);
    expect(tokenOf(cookie)).not.toBe(tokenOf(earlier));
    expect(await sessionTokens()).toEqual([tokenOf(cookie)]);
  });

  it("leaves other sessions alone, and ignores an earlier session that already ended", async () => {
    const elsewhere = await passwordSession();
    const ended = await passwordSession();
    expect((await http("/sign-out", { cookie: ended, body: {} })).status).toBe(200);
    const { response, cookie } = await passkeySignIn(ended);
    expect(response.status).toBe(200);
    const tokens = await sessionTokens();
    expect(tokens).toHaveLength(2);
    expect(tokens).toEqual(expect.arrayContaining([tokenOf(elsewhere), tokenOf(cookie)]));
  });

  it("keeps the browser's session when the new session is that same one", async () => {
    const earlier = await passwordSession();
    const token = tokenOf(earlier) ?? "";
    // A session store that hands the browser its own session back: the hook must not delete it.
    const context = await auth.$context;
    const create = context.internalAdapter.createSession.bind(context.internalAdapter);
    vi.spyOn(context.internalAdapter, "createSession").mockImplementation(async (...args) => {
      const created = await create(...args);
      await db.delete(schema.session).where(eq(schema.session.token, created.token));
      const [kept] = await db.select().from(schema.session).where(eq(schema.session.token, token));
      return { ...created, ...kept, token };
    });
    const { response } = await passkeySignIn(earlier);
    expect(response.status).toBe(200);
    expect(await sessionTokens()).toEqual([token]);
  });

  it("refuses an assertion another key signed, and keeps the earlier session", async () => {
    const earlier = await passwordSession();
    const { response } = await passkeySignIn(earlier, true);
    expect(response.status).toBe(401);
    expect(await sessionTokens()).toEqual([tokenOf(earlier)]);
  });
});
