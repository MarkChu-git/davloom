import { Context, Data, Effect, Layer } from "effect";

// The credential cipher (Decision 7 of add-phase-1-core). An S3-compatible backend's secret key is
// stored only encrypted, with AES-256-GCM under a key that HKDF-SHA-256 derives from the instance
// secret `DAVLOOM_SECRET`. Each value gets a random 96-bit IV, and the backend's id is the
// additional data, so a ciphertext copied to another backend's row fails to decrypt. Web Crypto
// does the same on Workers and on Bun.

/**
 * A stored secret key that does not decrypt: the instance secret differs from the one that
 * encrypted it, the value belongs to another backend, or it is damaged. Its text holds no secret.
 */
export class CredentialsError extends Data.TaggedError("CredentialsError")<{
  readonly backendId: string;
  readonly message: string;
}> {}

/** The Port that encrypts the secret keys of storage backends for storage and decrypts them. */
export class CredentialCipher extends Context.Service<
  CredentialCipher,
  {
    /** Encrypts a backend's secret key, bound to the backend's id. */
    readonly seal: (backendId: string, secretKey: string) => Effect.Effect<string>;
    /** Decrypts a value that `seal` returned for the same backend under the same instance secret. */
    readonly open: (backendId: string, sealed: string) => Effect.Effect<string, CredentialsError>;
  }
>()("@davloom/core/CredentialCipher") {}

// A stored value is `v1.<IV>.<ciphertext and tag>`, both in base64, which never holds a dot. The
// version names the derivation and the cipher, so a later scheme can still read these values.
const VERSION = "v1";
const IV_BYTES = 12;
// The purpose of the derived key. A key that the instance secret derives for another purpose,
// with other info, differs from this one.
const INFO = "davloom storage-backends secret-key v1";

const encoder = new TextEncoder();
// Fatal, so bytes that are not UTF-8 fail to open instead of becoming replacement characters.
const decoder = new TextDecoder("utf-8", { fatal: true });

// `String.fromCharCode` takes one argument per byte, and the runtimes limit the arguments of one
// call: 125,000 bytes threw a RangeError in workerd and 1,000,000 on Bun 1.4.4. So it gets slices.
const SLICE = 0x8000;

const toBase64 = (bytes: Uint8Array): string => {
  let binary = "";
  for (let start = 0; start < bytes.length; start += SLICE) {
    binary += String.fromCharCode(...bytes.subarray(start, start + SLICE));
  }
  return btoa(binary);
};

// The bytes of a base64 string. `atob` throws on a character outside base64, but it skips
// whitespace and accepts missing padding, which is harmless because the tag authenticates the bytes.
const fromBase64 = (text: string): Uint8Array<ArrayBuffer> =>
  Uint8Array.from(atob(text), (character) => character.charCodeAt(0));

const deriveKey = async (instanceSecret: string): Promise<CryptoKey> => {
  const material = await crypto.subtle.importKey(
    "raw",
    encoder.encode(instanceSecret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return await crypto.subtle.deriveKey(
    { name: "HKDF", hash: "SHA-256", salt: new Uint8Array(), info: encoder.encode(INFO) },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
};

/**
 * Builds the cipher for an instance secret. The Layers check the secret's length before they build
 * it (task 7.4 of add-phase-1-core).
 */
export const makeCredentialCipher = (
  instanceSecret: string,
): Effect.Effect<Context.Service.Shape<typeof CredentialCipher>> =>
  Effect.map(
    Effect.promise(async () => await deriveKey(instanceSecret)),
    (key) => ({
      seal: (backendId, secretKey) =>
        Effect.promise(async () => {
          const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
          const sealed = await crypto.subtle.encrypt(
            { name: "AES-GCM", iv, additionalData: encoder.encode(backendId) },
            key,
            encoder.encode(secretKey),
          );
          return [VERSION, toBase64(iv), toBase64(new Uint8Array(sealed))].join(".");
        }),
      open: (backendId, sealed) =>
        Effect.tryPromise({
          try: async () => {
            const [version, iv, data, ...rest] = sealed.split(".");
            if (version !== VERSION || iv === undefined || data === undefined || rest.length > 0) {
              throw new Error("not a sealed value");
            }
            const ivBytes = fromBase64(iv);
            if (ivBytes.length !== IV_BYTES) {
              throw new Error("not a 96-bit IV");
            }
            const plain = await crypto.subtle.decrypt(
              { name: "AES-GCM", iv: ivBytes, additionalData: encoder.encode(backendId) },
              key,
              fromBase64(data),
            );
            return decoder.decode(plain);
          },
          // The cause stays out of the error, so nothing of the value or the keys can reach it.
          catch: () =>
            new CredentialsError({
              backendId,
              message: `The secret key of backend ${backendId} does not decrypt under this instance's DAVLOOM_SECRET: the secret has changed since the key was saved, or the stored value belongs to another backend or is damaged.`,
            }),
        }),
    }),
  );

/** The cipher as a Layer, for the backend service. */
export const credentialCipherLayer = (instanceSecret: string): Layer.Layer<CredentialCipher> =>
  Layer.effect(CredentialCipher, makeCredentialCipher(instanceSecret));
