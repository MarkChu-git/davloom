import { describe, expect, it } from "vitest";
import { translator } from "../i18n/translate";
import { backendStatus, storageAlert } from "./backendStatus";

const en = translator("en");
const zh = translator("zh-CN");

describe("backend status", () => {
  it("an answering backend is Available, and one that does not answer is Unavailable", () => {
    expect(backendStatus(en, { available: true })).toEqual({ tone: "success", label: "Available" });
    expect(backendStatus(en, { available: false })).toEqual({
      tone: "error",
      label: "Unavailable",
    });
  });

  it.each([
    [undefined, undefined],
    [[], undefined],
    [[{ available: true }], undefined],
    [[{ available: false }, { available: true }], "1 backend unavailable"],
    [[{ available: false }, { available: false }], "2 backends unavailable"],
  ])("%j alerts %j", (backends, text) => {
    expect(storageAlert(en, backends)?.text).toBe(text);
  });

  it("says it in Chinese", () => {
    expect(backendStatus(zh, { available: false }).label).toBe("不可用");
    expect(storageAlert(zh, [{ available: false }, { available: false }])?.text).toBe(
      "2 个后端不可用",
    );
  });
});
