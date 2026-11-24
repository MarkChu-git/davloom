import { describe, expect, it } from "vitest";
import { passwordProblem, registrationProblems, safeRedirect } from "./forms";

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

describe("registration", () => {
  const valid = { username: "owner", name: "", email: "", password: "a long password here" };

  it.each([
    ["no display name and no email", {}],
    ["a display name and an email", { name: "Ada", email: "ada@example.com" }],
    ["a username of 3 characters", { username: "abc" }],
    ["a username of 30 characters", { username: "a".repeat(30) }],
    ["dots and underscores", { username: "a.b_c" }],
    ["a password of 12 characters", { password: "x".repeat(12) }],
    ["a password of 128 characters", { password: "x".repeat(128) }],
  ])("takes %s", (_case, change) => {
    expect(registrationProblems({ ...valid, ...change })).toEqual({});
  });

  it.each([
    ["username", { username: "" }],
    ["username", { username: "  " }],
    ["username", { username: "ab" }],
    ["username", { username: "a".repeat(31) }],
    ["username", { username: "with space" }],
    ["username", { username: "me@example.com" }],
    ["name", { name: "n".repeat(101) }],
    ["email", { email: "nope" }],
    ["password", { password: "x".repeat(11) }],
    ["password", { password: "x".repeat(129) }],
  ])("refuses a %s of %j", (field, change) => {
    expect(Object.keys(registrationProblems({ ...valid, ...change }))).toEqual([field]);
  });

  it("names every field that cannot be sent", () => {
    expect(
      Object.keys(registrationProblems({ username: "", name: "", email: "x", password: "" })),
    ).toEqual(["username", "email", "password"]);
  });
});

describe("passwordProblem", () => {
  it.each([
    ["", "Use at least 12 characters."],
    ["x".repeat(11), "Use at least 12 characters."],
    ["x".repeat(12), undefined],
    ["x".repeat(128), undefined],
    ["x".repeat(129), "Use at most 128 characters."],
  ])("of %j is %j", (password, problem) => {
    expect(passwordProblem(password)).toBe(problem);
  });
});
