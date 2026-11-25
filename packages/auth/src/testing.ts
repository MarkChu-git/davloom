// Helpers for tests that sign in through Better Auth: an authenticator app's TOTP codes, and the
// Cookie header a browser sends back. Production code does not import this module.

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

const fromBase32 = (text: string): Uint8Array<ArrayBuffer> => {
  const bits = text
    .replace(/=+$/, "")
    .toUpperCase()
    .split("")
    .map((c) => BASE32.indexOf(c).toString(2).padStart(5, "0"))
    .join("");
  const bytes = new Uint8Array(Math.floor(bits.length / 8));
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number.parseInt(bits.slice(index * 8, index * 8 + 8), 2);
  }
  return bytes;
};

/** The secret of an otpauth:// URI. */
export const totpSecretOf = (uri: string): string => new URL(uri).searchParams.get("secret") ?? "";

/** The 6-digit code an authenticator shows at `now` for a base32 secret (RFC 6238, SHA-1, 30 s). */
export const totpCode = async (secret: string, now = Date.now()): Promise<string> => {
  const counter = new DataView(new ArrayBuffer(8));
  counter.setBigUint64(0, BigInt(Math.floor(now / 30_000)));
  const key = await crypto.subtle.importKey(
    "raw",
    fromBase32(secret),
    { name: "HMAC", hash: "SHA-1" },
    false,
    ["sign"],
  );
  const mac = new DataView(await crypto.subtle.sign("HMAC", key, counter.buffer));
  // Dynamic truncation (RFC 4226 §5.3): 31 bits from the offset the last byte's low nibble names.
  const offset = mac.getUint8(mac.byteLength - 1) & 0x0f;
  const value = mac.getUint32(offset) & 0x7fffffff;
  return String(value % 1_000_000).padStart(6, "0");
};

/** Turns a response's Set-Cookie headers into the Cookie header a browser would send back. */
export const cookieHeader = (response: Response): string =>
  response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(";")[0])
    .filter((cookie) => cookie !== undefined && !cookie.endsWith("="))
    .join("; ");
