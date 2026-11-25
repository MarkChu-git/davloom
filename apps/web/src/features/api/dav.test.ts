import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { translator } from "../i18n/translate";
import { DavError, davHref, davProblem, entriesOf, hrefParts, type DavResponse } from "./dav";

const en = translator("en");

const response = (href: string, rest: Partial<DavResponse> = {}): DavResponse => ({
  href,
  isCollection: false,
  contentLength: null,
  lastModified: null,
  contentType: null,
  ...rest,
});

describe("WebDAV addresses", () => {
  it.each([
    [[], false, "/dav/"],
    [["files"], true, "/dav/files/"],
    [["files", "Invoices 2026"], true, "/dav/files/Invoices%202026/"],
    [["files", "a#b?c%d.txt"], false, "/dav/files/a%23b%3Fc%25d.txt"],
    [["files", "中文.md"], false, "/dav/files/%E4%B8%AD%E6%96%87.md"],
  ])("%j (folder %s) is %s", (parts, isFolder, href) => {
    expect(davHref(parts, isFolder)).toBe(href);
  });

  it.each([
    ["/dav/files/", ["files"]],
    ["/dav/files/Invoices%202026/", ["files", "Invoices 2026"]],
    ["http://example.com/dav/files/a%23b.txt", ["files", "a#b.txt"]],
    ["/other/files/", undefined],
    ["/dav/files/%E0%A4%A", undefined],
  ])("the href %s names %j", (href, parts) => {
    expect(hrefParts(href)).toEqual(parts);
  });

  it("an href read back names the parts it was made of, whatever the names", () => {
    // Any name the server accepts: no slash, no NUL, not . or .., with no lone surrogate.
    const name = fc
      .string({ minLength: 1, maxLength: 12, unit: "grapheme" })
      .filter(
        (value) => !value.includes("/") && !value.includes("\0") && value !== "." && value !== "..",
      );
    fc.assert(
      fc.property(
        fc.array(name, { minLength: 1, maxLength: 4 }),
        fc.boolean(),
        (parts, isFolder) => {
          expect(hrefParts(davHref(parts, isFolder))).toEqual(parts);
        },
      ),
    );
  });
});

describe("folder listings", () => {
  it("keeps the entries directly inside the folder, folders and files apart", () => {
    const entries = entriesOf(
      [
        response("/dav/files/Drafts/", { isCollection: true }),
        response("/dav/files/Drafts/notes.md", {
          contentLength: "120",
          lastModified: "Mon, 16 Nov 2026 15:30:00 GMT",
          contentType: "text/markdown",
        }),
        response("/dav/files/Drafts/Old/", {
          isCollection: true,
          lastModified: "not a date",
        }),
        response("/dav/files/Drafts/Old/deeper.txt"),
        response("/dav/files/Other/x.txt"),
      ],
      ["files", "Drafts"],
    );
    expect(entries).toEqual([
      {
        name: "notes.md",
        kind: "file",
        sizeBytes: 120,
        modifiedAt: "2026-11-16T15:30:00.000Z",
        contentType: "text/markdown",
        lock: null,
      },
      { name: "Old", kind: "folder", sizeBytes: 0, modifiedAt: "", contentType: "", lock: null },
    ]);
  });

  it("a size the server did not send reads as zero", () => {
    expect(entriesOf([response("/dav/m/a", { contentLength: "junk" })], ["m"])[0]?.sizeBytes).toBe(
      0,
    );
  });
});

describe("refusals", () => {
  it.each([
    [0, "could not be reached"],
    [401, "Sign in again"],
    [403, "may not change"],
    [404, "/files is no longer there"],
    [405, "already there"],
    [409, "does not exist"],
    [412, "already there"],
    [413, "larger than one request"],
    [423, "locked"],
    [501, "does not serve files"],
    [502, "could not be read"],
    [503, "not answering"],
    [507, "full"],
    [500, "(500)"],
  ])("%d says %s", (status, words) => {
    expect(davProblem(en, new DavError(status), "/files")).toContain(words);
  });

  it("an error that is not a refusal asks to try again", () => {
    expect(davProblem(en, new Error("boom"))).toBe("Something went wrong. Try again.");
  });

  it("names the path in Chinese too", () => {
    expect(davProblem(translator("zh-CN"), new DavError(404), "/files")).toContain("/files");
    expect(davProblem(translator("zh-CN"), new DavError(404), "/files")).not.toContain("no longer");
  });
});
