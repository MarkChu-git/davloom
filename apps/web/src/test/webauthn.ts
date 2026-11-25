import { vi } from "vitest";
import { json, type Handler } from "./render";

// A browser with a platform authenticator, for the passkey ceremonies of Better Auth's client:
// `PublicKeyCredential` exists, and `navigator.credentials` answers with a credential of fixed
// bytes, or refuses as a person who cancels the prompt does. The server's answers come from
// `passkeyApi`; the test checks what the Dashboard does with them, not the cryptography, which
// packages/auth tests with a real key.

const bytes = (text: string): ArrayBuffer => new TextEncoder().encode(text).buffer;

/** The credential an authenticator returns; WebAuthn's types are only partly needed here. */
const credential = (kind: "get" | "create") => ({
  id: "Y3JlZA",
  rawId: bytes("cred"),
  type: "public-key",
  authenticatorAttachment: "platform",
  getClientExtensionResults: () => ({}),
  response:
    kind === "get"
      ? {
          authenticatorData: bytes("auth"),
          clientDataJSON: bytes("{}"),
          signature: bytes("sig"),
          userHandle: null,
        }
      : {
          attestationObject: bytes("att"),
          clientDataJSON: bytes("{}"),
          getTransports: () => ["internal"],
          getPublicKeyAlgorithm: () => -7,
          getPublicKey: () => null,
          getAuthenticatorData: () => bytes("auth"),
        },
});

/** Makes this browser one that can use passkeys; `cancel` makes its authenticator refuse. */
export const stubPasskeys = ({ cancel = false }: { cancel?: boolean } = {}) => {
  vi.stubGlobal("PublicKeyCredential", function PublicKeyCredential() {});
  const answer = (kind: "get" | "create") => () =>
    cancel
      ? Promise.reject(new DOMException("The person cancelled.", "NotAllowedError"))
      : Promise.resolve(credential(kind));
  const credentials = { get: vi.fn(answer("get")), create: vi.fn(answer("create")) };
  Object.defineProperty(navigator, "credentials", { value: credentials, configurable: true });
  return credentials;
};

/** The server's side of the ceremonies: options, and each verification's answer. */
export const passkeyApi = ({
  authentication = () => json({ session: { token: "new" }, user: { id: "u" } }),
  registration = () => json({ id: "pk2", name: "This device" }),
}: { authentication?: Handler; registration?: Handler } = {}): Record<string, Handler> => ({
  "GET /api/auth/passkey/generate-authenticate-options": () =>
    json({
      challenge: "Y2hhbGxlbmdl",
      rpId: "davloom.test",
      allowCredentials: [],
      timeout: 60_000,
    }),
  "POST /api/auth/passkey/verify-authentication": authentication,
  "GET /api/auth/passkey/generate-register-options": () =>
    json({
      challenge: "Y2hhbGxlbmdl",
      rp: { id: "davloom.test", name: "Davloom" },
      user: { id: "dQ", name: "ada", displayName: "Ada" },
      pubKeyCredParams: [{ type: "public-key", alg: -7 }],
      timeout: 60_000,
      excludeCredentials: [],
    }),
  "POST /api/auth/passkey/verify-registration": registration,
});
