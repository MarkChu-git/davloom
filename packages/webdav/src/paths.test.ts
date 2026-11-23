import { describe, expect, it } from "vitest";
import { hrefOf, parseDavPath, parseDestination } from "./paths";

const BASE = "/dav";
const REQUEST = new URL("https://dav.example/dav/source");

describe("parseDavPath", () => {
  it.each([
    ["/dav", []],
    ["/dav/", []],
    ["/dav/a", ["a"]],
    ["/dav/a/b/", ["a", "b"]],
    ["/dav//a", ["a"]],
    // Percent-encoded UTF-8 (RFC 3986 §2.1, §2.5).
    ["/dav/%E4%B8%AD%E6%96%87", ["中文"]],
    ["/dav/a%20b", ["a b"]],
    ["/dav/100%25", ["100%"]],
  ])("%s is %j", (pathname, path) => {
    expect(parseDavPath(pathname, BASE)).toEqual(path);
  });

  it.each([
    ["outside the base path", "/other/a"],
    ["a prefix of a longer segment", "/davx/a"],
    ["an encoded slash in a name", "/dav/a%2Fb"],
    ["a NUL", "/dav/%00"],
    ["invalid UTF-8", "/dav/%FF"],
    ["a broken escape", "/dav/%E4%B8"],
  ])("is null for %s", (_, pathname) => {
    expect(parseDavPath(pathname, BASE)).toBeNull();
  });
});

describe("hrefOf", () => {
  it.each([
    [[], true, "/dav/"],
    [[], false, "/dav/"],
    [["a"], false, "/dav/a"],
    [["a"], true, "/dav/a/"],
    [["a", "b c"], false, "/dav/a/b%20c"],
    [["中"], false, "/dav/%E4%B8%AD"],
    [["q?x#y"], false, "/dav/q%3Fx%23y"],
  ])("hrefOf(%j, collection %s) is %s", (path, collection, href) => {
    expect(hrefOf(BASE, path, collection)).toBe(href);
  });

  it.each([["a"], ["a b", "中"], ["100%", "q?x#y"]])(
    "parses back to the same path: %j",
    (...path) => {
      expect(parseDavPath(hrefOf(BASE, path, false), BASE)).toEqual(path);
    },
  );
});

describe("parseDestination (RFC 4918 §10.3)", () => {
  it.each([
    ["an absolute URI", "https://dav.example/dav/a/b", { kind: "path", path: ["a", "b"] }],
    ["an absolute path", "/dav/a", { kind: "path", path: ["a"] }],
    ["the base path itself", "https://dav.example/dav", { kind: "path", path: [] }],
    ["an encoded name", "/dav/a%20b", { kind: "path", path: ["a b"] }],
    ["another host", "https://other.example/dav/a", { kind: "foreign" }],
    ["another port", "https://dav.example:8443/dav/a", { kind: "foreign" }],
    ["a path outside the base path", "https://dav.example/other/a", { kind: "foreign" }],
    ["a longer first segment", "/davx/a", { kind: "foreign" }],
    ["an invalid name", "/dav/a%2Fb", { kind: "invalid" }],
    ["a URL that does not parse", "https://[", { kind: "invalid" }],
  ])("reads %s", (_, header, destination) => {
    expect(parseDestination(header, REQUEST, BASE)).toEqual(destination);
  });

  it("is null when the header is absent", () => {
    expect(parseDestination(null, REQUEST, BASE)).toBeNull();
  });
});
