import { describe, expect, it } from "vitest";
import { safeRedirect, setupProblems } from "./forms";

describe("where sign-in returns", () => {
  it.each([
    [undefined, "/"],
    ["/files?path=%2Ffiles", "/files?path=%2Ffiles"],
    ["/credentials", "/credentials"],
    ["//evil.example", "/"],
    ["/\\evil.example", "/"],
    ["https://evil.example/", "/"],
    ["files", "/"],
  ])("%j goes to %j", (target, href) => {
    expect(safeRedirect(target)).toBe(href);
  });
});

describe("first-run setup", () => {
  const valid = {
    name: "Admin",
    email: "admin@example.com",
    password: "correct horse battery staple",
    token: "token",
  };

  it("takes a name, an email, a password of 12 to 128 characters and the token", () => {
    expect(setupProblems(valid)).toEqual({});
    expect(setupProblems({ ...valid, password: "x".repeat(12) })).toEqual({});
    expect(Object.keys(setupProblems({ ...valid, password: "x".repeat(11) }))).toEqual([
      "password",
    ]);
    expect(Object.keys(setupProblems({ ...valid, password: "x".repeat(129) }))).toEqual([
      "password",
    ]);
    expect(
      Object.keys(setupProblems({ name: " ", email: "nope", password: "", token: " " })),
    ).toEqual(["name", "email", "password", "token"]);
  });
});
