import { Cause, Effect, Exit } from "effect";
import { describe, expect, it } from "vitest";
import {
  CredentialCipher,
  credentialCipherLayer,
  CredentialsError,
  makeCredentialCipher,
} from "./credentials";

const INSTANCE = "an instance secret of more than 32 bytes, for the tests";
const OTHER_INSTANCE = "another instance secret of more than 32 bytes";
const SECRET_KEY = "not-a-real-s3-secret-key/for-the-tests";
const BACKEND = "0193f3c2-7a11-7d42-9d2c-1c2b3a4d5e6f";
const OTHER_BACKEND = "0193f3c2-7a11-7d42-9d2c-aaaaaaaaaaaa";

// Each helper builds the cipher again, as an instance does when it starts, so a value that one
// seals and another opens has also survived a restart.
const cipher = async (instanceSecret = INSTANCE) =>
  await Effect.runPromise(makeCredentialCipher(instanceSecret));

const sealWith = async (instanceSecret: string, backendId: string, secretKey: string) =>
  await Effect.runPromise((await cipher(instanceSecret)).seal(backendId, secretKey));

const openWith = async (instanceSecret: string, backendId: string, sealed: string) =>
  await Effect.runPromiseExit((await cipher(instanceSecret)).open(backendId, sealed));

// The error of a failed opening, which has to be a credentials error.
const failure = (exit: Exit.Exit<string, CredentialsError>): CredentialsError => {
  if (Exit.isSuccess(exit)) {
    throw new Error(`opened as ${exit.value}`);
  }
  const error = Cause.findErrorOption(exit.cause);
  if (error._tag === "None") {
    throw new Error(`failed without an error: ${Cause.pretty(exit.cause)}`);
  }
  return error.value;
};

// Every text that could reach a log or a response: the message, the string, the JSON and the
// cause as Effect prints it.
const texts = (exit: Exit.Exit<string, CredentialsError>): string[] => {
  const error = failure(exit);
  return [
    error.message,
    String(error),
    JSON.stringify(error),
    Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "",
  ];
};

// The sealed value with its `index`th part replaced.
const withPart = (sealed: string, index: number, part: string): string =>
  sealed
    .split(".")
    .map((current, at) => (at === index ? part : current))
    .join(".");

// The base64 `text` with one bit of its first byte flipped.
const flipped = (text: string): string => {
  const bytes = Uint8Array.from(atob(text), (character) => character.charCodeAt(0));
  bytes[0] = (bytes[0] ?? 0) ^ 1;
  return btoa(String.fromCharCode(...bytes));
};

describe("the credential cipher", () => {
  it("a secret round-trips", async () => {
    const sealed = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    expect(await openWith(INSTANCE, BACKEND, sealed)).toEqual(Exit.succeed(SECRET_KEY));
  });

  it("opens a value that an independent implementation also opens", async () => {
    // Sealed on 2026-11-20 by the first version of this cipher. pyca/cryptography 50.0.2 opens it
    // too, with HKDF-SHA-256 over the instance secret's UTF-8 bytes, an empty salt and the info
    // "davloom storage-backends secret-key v1", then AES-256-GCM with the backend's id as the
    // additional data. Stored secret keys have to stay readable, so a change to the derivation,
    // the info or the format fails here.
    const recorded =
      "v1.oOPxjeuyALHM2Xb/.7ls/mM9G079JCpOAdy+ZsPc1j5clAF+c9RonLIAufYL4BjDGFk2xUzI5Rt6DupzhBA==";
    expect(
      await openWith("the instance secret that sealed the recorded value", BACKEND, recorded),
    ).toEqual(Exit.succeed("not-a-real-s3-secret-key/recorded"));
  });

  it.each([
    ["an empty secret key", ""],
    ["a secret key with Unicode", "clé-秘密-🔑"],
    ["a long secret key", "k".repeat(4096)],
    // Longer than the arguments that one call of String.fromCharCode takes on either runtime.
    ["a secret key of a mebibyte", "k".repeat(2 ** 20)],
  ])("round-trips %s", async (_what, secretKey) => {
    const sealed = await sealWith(INSTANCE, BACKEND, secretKey);
    expect(await openWith(INSTANCE, BACKEND, sealed)).toEqual(Exit.succeed(secretKey));
  });

  it("stores no part of the secret key in the plain", async () => {
    const sealed = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    expect(sealed).toMatch(/^v1\.[A-Za-z0-9+/]{16}\.[A-Za-z0-9+/]+=*$/);
    const [, , data = ""] = sealed.split(".");
    const bytes = atob(data);
    // AES-GCM adds a 16-byte tag to a ciphertext as long as the plaintext.
    expect(bytes).toHaveLength(SECRET_KEY.length + 16);
    for (let start = 0; start + 6 <= SECRET_KEY.length; start += 1) {
      const part = SECRET_KEY.slice(start, start + 6);
      expect(bytes).not.toContain(part);
      expect(sealed).not.toContain(part);
    }
  });

  it("gives every value a new IV", async () => {
    const values = await Promise.all(
      Array.from({ length: 20 }, async () => await sealWith(INSTANCE, BACKEND, SECRET_KEY)),
    );
    const ivs = new Set(values.map((value) => value.split(".")[1]));
    expect(ivs.size).toBe(values.length);
    for (const value of values) {
      expect(await openWith(INSTANCE, BACKEND, value)).toEqual(Exit.succeed(SECRET_KEY));
    }
  });

  it("a ciphertext moved to another backend's id fails to decrypt", async () => {
    const sealed = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    const error = failure(await openWith(INSTANCE, OTHER_BACKEND, sealed));
    expect(error).toBeInstanceOf(CredentialsError);
    expect(error).toMatchObject({ _tag: "CredentialsError", backendId: OTHER_BACKEND });
  });

  it("a wrong instance secret gives a credentials error whose text holds no secret", async () => {
    const sealed = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    const exit = await openWith(OTHER_INSTANCE, BACKEND, sealed);
    expect(failure(exit)).toMatchObject({ _tag: "CredentialsError", backendId: BACKEND });
    for (const text of texts(exit)) {
      expect(text).toContain(BACKEND);
      for (const secret of [SECRET_KEY, INSTANCE, OTHER_INSTANCE, sealed]) {
        expect(text).not.toContain(secret);
      }
    }
    expect(failure(exit).message).toBe(
      `The secret key of backend ${BACKEND} does not decrypt under this instance's DAVLOOM_SECRET: the secret has changed since the key was saved, or the stored value belongs to another backend or is damaged.`,
    );
  });

  // Each value is sealed under INSTANCE for BACKEND and then changed.
  it.each([
    ["an empty value", () => ""],
    ["a value of another version", (sealed: string) => withPart(sealed, 0, "v2")],
    ["a value without its ciphertext", (sealed: string) => sealed.split(".").slice(0, 2).join(".")],
    ["a value with a part too many", (sealed: string) => `${sealed}.AAAA`],
    ["an IV that is not base64", (sealed: string) => withPart(sealed, 1, "not*base64")],
    ["a ciphertext that is not base64", (sealed: string) => withPart(sealed, 2, "not*base64")],
    ["an IV of 8 bytes", (sealed: string) => withPart(sealed, 1, btoa("8 bytes!"))],
    ["a changed IV", (sealed: string) => withPart(sealed, 1, flipped(sealed.split(".")[1] ?? ""))],
    [
      "a changed ciphertext",
      (sealed: string) => withPart(sealed, 2, flipped(sealed.split(".")[2] ?? "")),
    ],
    [
      "a ciphertext without its tag",
      (sealed: string) => {
        const data = sealed.split(".")[2] ?? "";
        return withPart(sealed, 2, btoa(atob(data).slice(0, -16)));
      },
    ],
  ])("refuses %s with a credentials error", async (_what, damage) => {
    const sealed = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    const exit = await openWith(INSTANCE, BACKEND, damage(sealed));
    expect(failure(exit)).toMatchObject({ _tag: "CredentialsError", backendId: BACKEND });
    for (const text of texts(exit)) {
      expect(text).not.toContain(SECRET_KEY);
      expect(text).not.toContain(INSTANCE);
    }
  });

  // Sealed by pyca/cryptography 50.0.2 under INSTANCE for BACKEND, with the derivation and the
  // additional data of "opens a value that an independent implementation also opens", so the tag
  // of each is valid and only the format refuses it.
  it.each([
    [
      "an IV of 8 bytes that the tag covers",
      "v1.OC1ieXRlISE=.ikxSVY7xEo7LUHWYjAy2L6rFdKdwpRWcyagstrh+yrj+UowRJH0AEexHq6xHQljotWMvgijH",
    ],
    [
      "a secret key whose bytes are not UTF-8",
      "v1.AAECAwQFBgcICQoL.pwukpkKGVOHKKd99RfqluFcUORaPqGxv03aZ2A==",
    ],
  ])("refuses %s", async (_what, sealed) => {
    const exit = await openWith(INSTANCE, BACKEND, sealed);
    expect(failure(exit)).toMatchObject({ _tag: "CredentialsError", backendId: BACKEND });
  });

  it("refuses the IV of another value", async () => {
    const first = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    const second = await sealWith(INSTANCE, BACKEND, SECRET_KEY);
    const swapped = withPart(first, 1, second.split(".")[1] ?? "");
    expect(failure(await openWith(INSTANCE, BACKEND, swapped))).toBeInstanceOf(CredentialsError);
  });

  it("is a Port that its Layer provides", async () => {
    const program = Effect.gen(function* () {
      const service = yield* CredentialCipher;
      const sealed = yield* service.seal(BACKEND, SECRET_KEY);
      return yield* service.open(BACKEND, sealed);
    });
    const opened = await Effect.runPromise(
      Effect.provide(program, credentialCipherLayer(INSTANCE)),
    );
    expect(opened).toBe(SECRET_KEY);
  });
});
