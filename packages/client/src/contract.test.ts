import { createApp } from "@davloom/api/app";
import { memoryInstance } from "@davloom/api/testing";
import { ApiErrorBody, ROUTES, type RouteName } from "@davloom/schema";
import { Exit, Schema } from "effect";
import { beforeAll, describe, expect, it } from "vitest";
import {
  createApiClient,
  jsonRequest,
  type Answer,
  type ApiClient,
  type Fetcher,
  type Outcome,
} from "./index";

// The typed client against the real app (apps/api createApp) on an in-memory instance: every route
// of the management API is called through the client, and its answer must have the status and the
// shape of its contract in packages/schema. The table below is also the type-level half: it needs
// one call for every route, and each call's answer must be the contract's, or tsc fails.

const ORIGIN = "https://davloom.test";
const SECRET = "client-contract-test-secret-0123456789abcdef";
const OWNER = { username: "owner", password: "a password long enough" };

const cookiesOf = (response: Response) =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .join("; ");

/** An app of its own, an owner, and a client that sends the owner's session as a browser would. */
const world = async () => {
  const app = createApp({ instance: () => memoryInstance(ORIGIN, SECRET) });
  let cookie = "";
  const fetcher: Fetcher = async (url, init) => {
    const { method, headers, body } = jsonRequest(init);
    return await app.handle(
      new Request(`${ORIGIN}${url}`, {
        method,
        body,
        headers: { ...headers, origin: ORIGIN, cookie },
      }),
    );
  };
  const client = createApiClient({ fetcher });
  const signIn = async () => {
    const signedIn = await fetcher("/api/auth/sign-in/username", {
      method: "POST",
      body: JSON.stringify(OWNER),
    });
    expect(signedIn.status).toBe(200);
    cookie = cookiesOf(signedIn);
  };
  return { client, signIn };
};

interface Context {
  readonly client: ApiClient;
  /** What earlier calls created, for the calls that name it. */
  readonly made: { key: string; backend: string; mount: string; exported: unknown };
}

/** The id in an answer, or a failed test. */
const idOf = (outcome: Outcome<{ readonly id: string }>): string => {
  if (outcome.error !== null) throw new Error(`refused: ${JSON.stringify(outcome.error)}`);
  return outcome.data.id;
};

/** One call of the client for every route, in the order they run. */
const CALLS: {
  readonly [Name in RouteName]: (context: Context) => Promise<Outcome<Answer<Name>>>;
} = {
  "GET /api/health": ({ client }) => client.health.get(),
  "GET /api/registration": ({ client }) => client.registration.get(),
  "POST /api/registration": ({ client }) => client.registration.post({ ...OWNER, name: "Owner" }),
  "POST /api/verify": ({ client }) => client.verify.post({ password: OWNER.password }),
  "GET /api/me": ({ client }) => client.me.get(),
  "GET /api/instance": ({ client }) => client.instance.get(),
  "POST /api/backends": async ({ client, made }) => {
    const outcome = await client.backends.post({ name: "Memory", kind: "memory" });
    made.backend = idOf(outcome);
    return outcome;
  },
  "GET /api/backends": ({ client }) => client.backends.get(),
  "PATCH /api/backends/:id": ({ client, made }) =>
    client.backends({ id: made.backend }).patch({ name: "Memory store" }),
  "POST /api/backends/check": ({ client }) => client.backends.check.post(),
  "POST /api/backends/:id/verify": ({ client, made }) =>
    client.backends({ id: made.backend }).verify.post(),
  "PUT /api/settings/storage": ({ client, made }) =>
    client.settings.storage.put({ defaultBackendId: made.backend }),
  "GET /api/settings/storage": ({ client }) => client.settings.storage.get(),
  "POST /api/mounts": async ({ client, made }) => {
    const outcome = await client.mounts.post({ name: "photos", backendId: made.backend, root: "" });
    made.mount = idOf(outcome);
    return outcome;
  },
  "GET /api/mounts": ({ client }) => client.mounts.get(),
  "PATCH /api/mounts/:id": ({ client, made }) =>
    client.mounts({ id: made.mount }).patch({ name: "pictures" }),
  "POST /api/keys": async ({ client }) => {
    const outcome = await client.keys.post({
      name: "Laptop",
      access: "read-write",
      expiresInDays: 30,
      paths: null,
    });
    return outcome;
  },
  "GET /api/keys": async ({ client, made }) => {
    const outcome = await client.keys.get();
    made.key = outcome.data?.[0]?.id ?? "";
    return outcome;
  },
  "PATCH /api/keys/:id": ({ client, made }) =>
    client.keys({ id: made.key }).patch({ name: "Old laptop" }),
  "DELETE /api/keys/:id": ({ client, made }) => client.keys({ id: made.key }).delete(),
  "GET /api/overview": ({ client }) => client.overview.get(),
  "GET /api/operations": ({ client }) => client.operations.get(),
  "GET /api/audit": ({ client }) => client.audit.get({ query: { limit: "5" } }),
  "GET /api/openapi.json": ({ client }) => client["openapi.json"].get(),
  "POST /api/export": async ({ client, made }) => {
    const outcome = await client.export.post();
    made.exported = outcome.data;
    return outcome;
  },
  "DELETE /api/mounts/:id": ({ client, made }) => client.mounts({ id: made.mount }).delete(),
  "DELETE /api/backends/:id": ({ client, made }) => client.backends({ id: made.backend }).delete(),
  // Into an instance of its own, which has no owner yet.
  "POST /api/registration/import": async ({ made }) => {
    const { client } = await world();
    const key: unknown = Reflect.get(Object(made.exported), "key");
    const file: unknown = Reflect.get(Object(made.exported), "file");
    return await client.registration.import.post({ key: String(key), file });
  },
};

const ORDER = Object.keys(CALLS).filter((name): name is RouteName => Object.hasOwn(ROUTES, name));

/** What each route answered, by its name. */
const answers = new Map<RouteName, Outcome<unknown>>();

beforeAll(async () => {
  const { client, signIn } = await world();
  const context: Context = {
    client,
    made: { key: "", backend: "", mount: "", exported: null },
  };
  for (const name of ORDER) {
    answers.set(name, await CALLS[name](context));
    // The session starts once the owner exists.
    if (name === "POST /api/registration") await signIn();
  }
});

describe("the typed client against the app", () => {
  it("calls every route of the contracts", () => {
    expect(ORDER.toSorted()).toEqual(Object.keys(ROUTES).toSorted());
  });

  it.each(ORDER)("%s answers its contract's status and shape", (name) => {
    const outcome = answers.get(name);
    if (outcome === undefined) throw new Error(`${name} did not run`);
    if (outcome.error !== null) {
      throw new Error(`${name} was refused: ${JSON.stringify(outcome.error)}`);
    }
    const contract = ROUTES[name];
    expect(Reflect.get(outcome, "status")).toBe(contract.status);
    const decoded = Schema.decodeUnknownExit(contract.response)(outcome.data);
    expect(Exit.isSuccess(decoded), JSON.stringify(decoded)).toBe(true);
  });
});

describe("the typed client's refusals", () => {
  const isErrorBody = Schema.is(ApiErrorBody);

  it("hands back a refusal's status and the API's error body", async () => {
    const { client } = await world();
    const outcome = await client.me.get();
    expect(outcome.error).toMatchObject({ status: 401 });
    expect(outcome.data).toBeNull();
    expect(isErrorBody(outcome.error?.value)).toBe(true);
  });

  it("sends a change as JSON from the page's origin, so the API takes it", async () => {
    const { client, signIn } = await world();
    await client.registration.post({ ...OWNER });
    await signIn();
    const outcome = await client.backends.check.post();
    expect(outcome.error).toBeNull();
  });

  it.each(["a/verify", "a?b=c", "a#b", "../keys", "%2F"])(
    "keeps the parameter %j in its own segment of the path",
    async (id) => {
      const { client, signIn } = await world();
      await client.registration.post({ ...OWNER });
      await signIn();
      // A segment that leaked would reach another route, or none, and not this route's not_found.
      const outcome = await client.backends({ id }).delete();
      expect(outcome.error).toMatchObject({
        status: 404,
        value: { error: { code: "not_found" } },
      });
    },
  );

  it("refuses a body of the wrong type with the contract's invalid_body", async () => {
    const { client, signIn } = await world();
    await client.registration.post({ ...OWNER });
    await signIn();
    // @ts-expect-error -- the contract types the name as a string
    const outcome = await client.keys.post({ name: 12, access: "read-only" });
    expect(outcome.error).toMatchObject({
      status: 422,
      value: { error: { code: "invalid_body" } },
    });
  });
});

// Type-level checks: a route the server does not have is no part of the client.
// @ts-expect-error -- there is no GET /api/nothing
export const missing = (client: ApiClient) => client.nothing.get();
