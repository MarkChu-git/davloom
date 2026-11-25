import { describe, expect, it } from "vitest";
import { GENERATED_PASSWORD_LENGTH, generatePassword, MIN_PASSWORD, setupKeyOf } from "./account";

// The account helpers that run without a server.

describe("setupKeyOf", () => {
  it.each([
    ["otpauth://totp/Davloom:ada?secret=JBSWY3DPEHPK3PXP&issuer=Davloom", "JBSWY3DPEHPK3PXP"],
    ["otpauth://totp/Davloom:ada?issuer=Davloom", ""],
    ["not a uri", ""],
    ["", ""],
  ])("reads %j as %j", (uri, key) => {
    expect(setupKeyOf(uri)).toBe(key);
  });
});

describe("generatePassword", () => {
  it("makes a different password each time, long enough for the server, of letters, digits, - and _", () => {
    const passwords = Array.from({ length: 100 }, () => generatePassword());
    for (const password of passwords) {
      expect(password).toMatch(new RegExp(`^[A-Za-z0-9_-]{${GENERATED_PASSWORD_LENGTH}}$`));
      expect(password.length).toBeGreaterThanOrEqual(MIN_PASSWORD);
    }
    expect(new Set(passwords).size).toBe(100);
  });
});
