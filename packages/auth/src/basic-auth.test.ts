import { describe, expect, it } from "vitest";
import { parseBasicCredentials } from "./basic-auth";

const basic = (value: string) => `Basic ${btoa(value)}`;

describe("parseBasicCredentials", () => {
  it("splits the username and the password", () => {
    expect(parseBasicCredentials(basic("alice:secret"))).toEqual({
      username: "alice",
      password: "secret",
    });
  });

  it("keeps colons in the password", () => {
    expect(parseBasicCredentials(basic("alice:se:cr:et"))?.password).toBe("se:cr:et");
  });

  it("decodes UTF-8", () => {
    const encoded = btoa(String.fromCharCode(...new TextEncoder().encode("文件:密码")));

    expect(parseBasicCredentials(`Basic ${encoded}`)).toEqual({
      username: "文件",
      password: "密码",
    });
  });

  it("accepts any case for the scheme", () => {
    expect(parseBasicCredentials(`bAsIc ${btoa("a:b")}`)?.username).toBe("a");
  });

  it.each([
    ["no header", null],
    ["another scheme", "Bearer abc"],
    ["no colon", basic("alice")],
    ["invalid base64", "Basic %%%"],
    ["an empty value", "Basic "],
  ])("returns null for %s", (_name, header) => {
    expect(parseBasicCredentials(header)).toBeNull();
  });
});
