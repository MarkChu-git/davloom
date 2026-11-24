import { Effect, Exit, Schema } from "effect";
import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  AuditQuery,
  CreateKeyRequest,
  RegistrationRequest,
  StorageSettings,
  UpdateMountRequest,
} from "./api";
import {
  BodyInvalid,
  BodyNotJson,
  decodeBody,
  decodeQuery,
  decodeWith,
  encodeWith,
  parseJson,
} from "./body";

const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runSyncExit(effect);

const failure = <A, E>(exit: Exit.Exit<A, E>): E | undefined =>
  Exit.isFailure(exit) ? Exit.findErrorOption(exit).valueOrUndefined : undefined;

const request = (body: string) =>
  new Request("https://davloom.test/api/x", { method: "POST", body });

describe("parseJson", () => {
  it.each([
    ["", {}],
    ["   ", {}],
    ["{}", {}],
    ['{"a":1}', { a: 1 }],
    ["[1]", [1]],
    ["null", null],
    ["7", 7],
  ])("reads %j as %j", (text, value) => {
    expect(Effect.runSync(parseJson(text))).toEqual(value);
  });

  it.each(["{", "not json", "{'a':1}", "[1,]", "undefined"])("refuses %j", (text) => {
    expect(failure(run(parseJson(text)))).toBeInstanceOf(BodyNotJson);
  });

  it("reads every JSON text that JSON.stringify writes", () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        expect(Effect.runSync(parseJson(JSON.stringify(value)))).toEqual(
          JSON.parse(JSON.stringify(value)),
        );
      }),
    );
  });
});

describe("decodeWith", () => {
  it("keeps a valid body as it is, without fields it does not know", () => {
    expect(
      Effect.runSync(decodeWith(CreateKeyRequest)({ name: "k", access: "read-only", extra: true })),
    ).toEqual({ name: "k", access: "read-only" });
  });

  it("names every field that has the wrong type", () => {
    const error = failure(run(decodeWith(CreateKeyRequest)({ name: 1, access: [], paths: [2] })));
    expect(error).toBeInstanceOf(BodyInvalid);
    expect(error?.issues.map((issue) => issue.path)).toEqual([["name"], ["access"], ["paths", 0]]);
    expect(error?.reason).toContain("name: ");
    expect(error?.reason).toContain("paths.0: ");
  });

  it("names the whole body when it is no object", () => {
    const error = failure(run(decodeWith(RegistrationRequest)([])));
    expect(error?.issues).toEqual([{ path: [], message: expect.any(String) }]);
    expect(error?.reason).not.toContain(": ");
  });

  it("decodes any body of strings, and refuses any field that is not one", () => {
    const fields = ["username", "name", "email", "password", "setupToken"] as const;
    fc.assert(
      fc.property(
        fc.record(Object.fromEntries(fields.map((key) => [key, fc.string()])), {
          requiredKeys: [],
        }),
        fc.constantFrom(...fields),
        fc.oneof(fc.integer(), fc.boolean(), fc.constant(null), fc.array(fc.string())),
        (valid, field, wrong) => {
          expect(Effect.runSync(decodeWith(RegistrationRequest)(valid))).toEqual(valid);
          const error = failure(run(decodeWith(RegistrationRequest)({ ...valid, [field]: wrong })));
          expect(error?.issues.map((issue) => issue.path)).toEqual([[field]]);
        },
      ),
    );
  });

  it.each([
    [{}, true],
    [{ name: "x" }, true],
    [{ backendId: "b", root: "" }, true],
    [{ backendId: null }, false],
    [{ root: 1 }, false],
  ])("decodes a Mount change %j: %s", (value, ok) => {
    expect(Exit.isSuccess(run(decodeWith(UpdateMountRequest)(value)))).toBe(ok);
  });
});

describe("decodeBody", () => {
  it("reads and decodes a request's body", async () => {
    expect(
      await Effect.runPromise(decodeBody(StorageSettings, request('{"defaultBackendId":null}'))),
    ).toEqual({ defaultBackendId: null });
  });

  it("refuses a body that is not JSON", async () => {
    const exit = await Effect.runPromiseExit(decodeBody(StorageSettings, request("{")));
    expect(failure(exit)).toBeInstanceOf(BodyNotJson);
  });

  it("refuses a body of the wrong shape", async () => {
    const exit = await Effect.runPromiseExit(decodeBody(StorageSettings, request("{}")));
    expect(failure(exit)).toBeInstanceOf(BodyInvalid);
  });

  it("reads a body it cannot read as empty", async () => {
    const used = request('{"defaultBackendId":"a"}');
    await used.text();
    const exit = await Effect.runPromiseExit(decodeBody(StorageSettings, used));
    expect(failure(exit)).toBeInstanceOf(BodyInvalid);
  });
});

describe("decodeQuery", () => {
  it.each([
    ["", {}],
    ["?limit=5", { limit: "5" }],
    ["?limit=100&before=1.a", { limit: "100", before: "1.a" }],
    ["?limit=5&limit=7", { limit: "5" }],
    ["?other=1", {}],
  ])("decodes %s", (query, value) => {
    expect(
      Effect.runSync(decodeQuery(AuditQuery, `https://davloom.test/api/audit${query}`)),
    ).toEqual(value);
  });

  it.each(["?limit=0", "?limit=-1", "?limit=1000", "?limit=x", "?limit="])(
    "refuses %s",
    (query) => {
      const exit = run(decodeQuery(AuditQuery, `https://davloom.test/api/audit${query}`));
      expect(failure(exit)?.issues[0]?.path).toEqual(["limit"]);
    },
  );
});

describe("encodeWith", () => {
  it("encodes an answer of its schema", () => {
    expect(Effect.runSync(encodeWith(StorageSettings)({ defaultBackendId: "a" }))).toEqual({
      defaultBackendId: "a",
    });
  });

  it("leaves out what the schema does not name", () => {
    expect(
      Effect.runSync(encodeWith(StorageSettings)({ defaultBackendId: null, secret: "s" })),
    ).toEqual({ defaultBackendId: null });
  });

  it("dies on an answer of another shape, a defect of the server", () => {
    const exit = run(encodeWith(StorageSettings)({ defaultBackendId: 1 }));
    expect(Exit.isFailure(exit) && Exit.hasDies(exit)).toBe(true);
  });

  it("round-trips what it decodes", () => {
    const schema = Schema.Struct({ a: Schema.String, b: Schema.NullOr(Schema.Finite) });
    fc.assert(
      fc.property(
        fc.string(),
        fc.option(fc.double({ noNaN: true, noDefaultInfinity: true })),
        (a, b) => {
          const value = { a, b };
          expect(
            Effect.runSync(encodeWith(schema)(Effect.runSync(decodeWith(schema)(value)))),
          ).toEqual(value);
        },
      ),
    );
  });
});
