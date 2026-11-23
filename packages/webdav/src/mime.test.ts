import { describe, expect, it } from "vitest";
import { contentTypeFor } from "./mime";

describe("contentTypeFor", () => {
  // The media types the IANA registry lists for each extension (text/markdown RFC 7763,
  // text/javascript RFC 9239, application/json RFC 8259, application/xml RFC 7303,
  // application/gzip RFC 6713, image/webp RFC 9649), with UTF-8 named for text.
  it.each([
    ["a.txt", "text/plain; charset=utf-8"],
    ["a.md", "text/markdown; charset=utf-8"],
    ["a.html", "text/html; charset=utf-8"],
    ["a.htm", "text/html; charset=utf-8"],
    ["a.css", "text/css; charset=utf-8"],
    ["a.csv", "text/csv; charset=utf-8"],
    ["a.js", "text/javascript; charset=utf-8"],
    ["a.json", "application/json"],
    ["a.xml", "application/xml"],
    ["a.pdf", "application/pdf"],
    ["a.zip", "application/zip"],
    ["a.tar.gz", "application/gzip"],
    ["a.png", "image/png"],
    ["a.jpg", "image/jpeg"],
    ["a.jpeg", "image/jpeg"],
    ["a.gif", "image/gif"],
    ["a.webp", "image/webp"],
    ["a.svg", "image/svg+xml"],
    ["a.ico", "image/x-icon"],
    ["a.mp3", "audio/mpeg"],
    ["a.wav", "audio/wav"],
    ["a.mp4", "video/mp4"],
    ["a.webm", "video/webm"],
    ["a.mov", "video/quicktime"],
  ])("guesses %s as %s", (name, type) => {
    expect(contentTypeFor(name, null)).toBe(type);
  });

  it.each([
    ["REPORT.PDF", "application/pdf"],
    ["Photo.JpG", "image/jpeg"],
  ])("ignores the case of the extension in %s", (name, type) => {
    expect(contentTypeFor(name, null)).toBe(type);
  });

  it.each([
    // No dot: the whole name is not an extension, even when it spells one.
    "txt",
    "README",
    // A leading dot marks a hidden file, not an extension.
    ".txt",
    ".json",
    "a.unknown",
    "a.",
    // Names on Object.prototype are not extensions.
    "a.toString",
    "a.constructor",
    "a.__proto__",
  ])("falls back to application/octet-stream for %j", (name) => {
    expect(contentTypeFor(name, null)).toBe("application/octet-stream");
  });

  it("keeps the type the file was stored with", () => {
    expect(contentTypeFor("a.txt", "application/x-custom")).toBe("application/x-custom");
    expect(contentTypeFor("noext", "text/plain")).toBe("text/plain");
  });

  it("guesses when the stored type is empty", () => {
    expect(contentTypeFor("a.txt", "")).toBe("text/plain; charset=utf-8");
  });
});
