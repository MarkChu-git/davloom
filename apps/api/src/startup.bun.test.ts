import { describe, expect, it } from "vitest";
import { startupWarnings } from "./startup.bun";

describe("startupWarnings", () => {
  it.each([
    [{}, /DAVLOOM_URL is not set.*Set DAVLOOM_URL to the address you open Davloom at/],
    [{ DAVLOOM_URL: " " }, /DAVLOOM_URL is not set/],
    [{ DAVLOOM_URL: "files.example.com" }, /is no http or https address/],
  ])("with %j warns", (env, message) => {
    const warnings = startupWarnings(env);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toMatch(message);
  });

  it("says nothing with a DAVLOOM_URL", () => {
    expect(startupWarnings({ DAVLOOM_URL: "https://files.example.com" })).toEqual([]);
  });
});
