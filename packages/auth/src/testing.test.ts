import { describe, expect, it } from "vitest";
import { cookieHeader, totpCode, totpSecretOf } from "./testing";

// The test helpers against the published test vectors, so a wrong code cannot pass a sign-in test
// by accident.

/** "12345678901234567890" in base32, the SHA-1 secret of RFC 6238 Appendix B. */
const RFC_SECRET = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

describe("totpCode", () => {
  it.each([
    [59, "287082"],
    [1_111_111_109, "081804"],
    [1_111_111_111, "050471"],
    [1_234_567_890, "005924"],
    [2_000_000_000, "279037"],
    [20_000_000_000, "353130"],
  ])("at %i s gives the last six digits of RFC 6238's %s", async (seconds, code) => {
    expect(await totpCode(RFC_SECRET, seconds * 1000)).toBe(code);
  });

  it("reads the secret in either case and with padding", async () => {
    expect(await totpCode(`${RFC_SECRET.toLowerCase()}====`, 59_000)).toBe("287082");
  });
});

describe("totpSecretOf", () => {
  it.each([
    ["otpauth://totp/Davloom:ada?secret=ABC&issuer=Davloom", "ABC"],
    ["otpauth://totp/Davloom:ada?issuer=Davloom", ""],
  ])("reads %s as %j", (uri, secret) => {
    expect(totpSecretOf(uri)).toBe(secret);
  });
});

describe("cookieHeader", () => {
  it("keeps the name and value of each cookie set, and drops the ones cleared", () => {
    const headers = new Headers();
    headers.append("set-cookie", "a=1; Path=/; HttpOnly");
    headers.append("set-cookie", "cleared=; Max-Age=0");
    headers.append("set-cookie", "b=2");
    expect(cookieHeader(new Response(null, { headers }))).toBe("a=1; b=2");
  });
});
