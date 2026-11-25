import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n/translate";
import { backendDetail } from "./backendDetail";

const en = translator("en");
const zh = translator("zh-CN");

describe("backendDetail", () => {
  it.each([
    [{ available: true, status: { state: "answered", ms: 38 } }, "Main answered in 38 ms."],
    [{ available: true, status: { state: "answered", ms: 999.4 } }, "Main answered in 999 ms."],
    [{ available: true, status: { state: "answered", ms: 1250 } }, "Main answered in 1.3 s."],
    [
      { available: false, status: { state: "failed", failure: "unavailable", ms: 30_000 } },
      "Main gave no answer after 30 s.",
    ],
    [
      { available: false, status: { state: "failed", failure: "insufficient-storage", ms: 5 } },
      "Main gave a full store after 5 ms.",
    ],
    [
      { available: false, status: { state: "failed", failure: "hidden-objects", ms: 5 } },
      "Main gave hidden-objects after 5 ms.",
    ],
    [
      { available: false, status: { state: "not-opened" } },
      "Main cannot be opened with its saved settings.",
    ],
  ] as const)("%j reads %s", (backend, text) => {
    expect(backendDetail(en, { name: "Main", ...backend })).toBe(text);
  });

  it("names a time in milliseconds below a second and in seconds from one", () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 600_000 }), (ms) => {
        const text = backendDetail(en, {
          name: "Main",
          available: true,
          status: { state: "answered", ms },
        });
        expect(text.endsWith(ms < 1000 ? " ms." : " s.")).toBe(true);
      }),
    );
  });

  it.each([
    [{ available: true, status: { state: "answered", ms: 38 } }, "Main 在 38 毫秒内响应。"],
    [{ available: true, status: { state: "answered", ms: 1250 } }, "Main 在 1.3 秒内响应。"],
    [{ available: false, status: { state: "not-opened" } }, "无法用已保存的设置打开 Main。"],
  ] as const)("%j reads %s in Chinese", (backend, text) => {
    expect(backendDetail(zh, { name: "Main", ...backend })).toBe(text);
  });
});
