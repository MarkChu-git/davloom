import { describe, expect, it } from "vitest";
import {
  formatBytes,
  formatCount,
  formatDate,
  formatDateTime,
  formatRelative,
  relativeSpan,
} from "./format";

const NOW = new Date("2026-11-16T15:30:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60_000).toISOString();

describe("formats", () => {
  it.each([
    [0, "0 bytes"],
    [1, "1 byte"],
    [999, "999 bytes"],
    [1000, "1 kB"],
    [48_200, "48.2 kB"],
    [1_240_000, "1.2 MB"],
    [2_000_000_000_000, "2 TB"],
  ])("%d bytes read %s", (bytes, text) => {
    expect(formatBytes(bytes, "en")).toBe(text);
  });

  it.each([
    [0, "0字节"],
    [999, "999字节"],
    [48_200, "48.2 kB"],
    [1_240_000, "1.2 MB"],
  ])("%d bytes read %s in Chinese", (bytes, text) => {
    expect(formatBytes(bytes, "zh-CN")).toBe(text);
  });

  it("counts group their thousands", () => {
    expect(formatCount(12_480, "en")).toBe("12,480");
    expect(formatCount(12_480, "zh-CN")).toBe("12,480");
  });

  it.each([
    [0, "this minute"],
    [2, "2 minutes ago"],
    [120, "2 hours ago"],
    [3 * 24 * 60, "3 days ago"],
    [65 * 24 * 60, "2 months ago"],
    [800 * 24 * 60, "2 years ago"],
    [-60, "in 1 hour"],
  ])("%d minutes ago reads %s", (minutes, text) => {
    expect(formatRelative(ago(minutes), "en", NOW)).toBe(text);
  });

  it.each([
    [0, "此刻"],
    [2, "2分钟前"],
    [120, "2小时前"],
    [-60, "1小时后"],
  ])("%d minutes ago reads %s in Chinese", (minutes, text) => {
    expect(formatRelative(ago(minutes), "zh-CN", NOW)).toBe(text);
  });

  it("a span is a whole count of the largest unit under the next", () => {
    expect(relativeSpan(ago(100), NOW)).toEqual({ count: -2, unit: "hour" });
  });

  it("dates read in the medium style", () => {
    expect(formatDate("2026-11-16T12:00:00Z", "en")).toBe("Nov 16, 2026");
    expect(formatDateTime("2026-11-16T12:00:00Z", "en")).toMatch(/^Nov 16, 2026/);
    expect(formatDate("2026-11-16T12:00:00Z", "zh-CN")).toBe("2026年11月16日");
    expect(formatDateTime("2026-11-16T12:00:00Z", "zh-CN")).toMatch(/^2026年11月16日/);
  });
});
