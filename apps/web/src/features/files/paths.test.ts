import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import {
  destinationProblem,
  filesHref,
  isWithin,
  joinPath,
  nameProblem,
  normalizePath,
  splitPath,
} from "./paths";
import { isPreviewable } from "./preview";

describe("paths", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/files//Drafts/", "/files/Drafts"],
    ["files/a", "/files/a"],
    ["/files/sub/..", "/"],
    ["/files/./a", "/"],
    ["/../files", "/"],
    ["/files/..a/b.", "/files/..a/b."],
  ])("%j normalizes to %j", (path, normalized) => {
    expect(normalizePath(path)).toBe(normalized);
  });

  it("joining the parts of a path gives the path back, normalized", () => {
    fc.assert(
      fc.property(fc.array(fc.constantFrom("a", "b", "", "/", "c d")), (pieces) => {
        const path = pieces.join("/");
        expect(joinPath(splitPath(path))).toBe(normalizePath(path));
        expect(normalizePath(normalizePath(path))).toBe(normalizePath(path));
      }),
    );
  });

  it.each([
    ["/files/a", "/files/a", true],
    ["/files/a/b", "/files/a", true],
    ["/files/ab", "/files/a", false],
    ["/files", "/files/a", false],
  ])("%s within %s: %s", (folder, source, within) => {
    expect(isWithin(folder, source)).toBe(within);
  });

  it.each([
    ["/", undefined, "/files"],
    ["/files", undefined, "/files?path=%2Ffiles"],
    ["/files/a b", "c.txt", "/files?path=%2Ffiles%2Fa+b&file=c.txt"],
  ])("Files of %s with %s is %s", (path, file, href) => {
    expect(filesHref(path, file)).toBe(href);
  });
});

describe("names", () => {
  it.each([
    ["Drafts", ["Other"], undefined],
    [" Drafts ", ["Other"], undefined],
    ["", [], "Enter a name."],
    ["  ", [], "Enter a name."],
    ["a/b", [], "Names cannot contain a slash."],
    [".", [], "Choose another name."],
    ["..", [], "Choose another name."],
    ["Drafts", ["Drafts"], "Something with this name is already here."],
  ])("%j among %j: %j", (name, siblings, problem) => {
    expect(nameProblem(name, siblings)).toBe(problem);
  });
});

describe("destinations", () => {
  it.each([
    ["/files", ["a"], "/files/b", undefined],
    ["/files", ["a"], "/other", undefined],
    ["/files", ["a"], "/", "Choose a folder inside a mount, such as /files."],
    ["/files", ["a"], "/files/../x", "Name the folder without . or .. in its path."],
    ["/files", ["a"], "/files/", "Choose another folder than the one they are in."],
    ["/files", ["a"], "/files/a", "A folder cannot go inside itself."],
    ["/files", ["a"], "/files/a/b", "A folder cannot go inside itself."],
    ["/files", ["a"], "/files/ab", undefined],
  ])("from %s, %j to %s: %j", (from, names, to, problem) => {
    expect(destinationProblem(from, names, to)).toBe(problem);
  });

  it("a destination is refused exactly when it is outside the mounts, the same folder, or inside an item", () => {
    const part = fc.constantFrom("m", "a", "b", "ab");
    fc.assert(
      fc.property(
        fc.array(part, { minLength: 1, maxLength: 3 }),
        fc.uniqueArray(part, { minLength: 1, maxLength: 2 }),
        fc.array(part, { maxLength: 4 }),
        (from, names, to) => {
          const problem = destinationProblem(joinPath(from), names, joinPath(to));
          const inside = names.some((name) => isWithin(joinPath(to), joinPath([...from, name])));
          const refused = to.length === 0 || joinPath(to) === joinPath(from) || inside;
          expect(problem !== undefined).toBe(refused);
        },
      ),
    );
  });
});

describe("previews", () => {
  it.each([
    [{ name: "a.md", contentType: "", sizeBytes: 10 }, true],
    [{ name: "a.bin", contentType: "text/plain; charset=utf-8", sizeBytes: 10 }, true],
    [{ name: "a", contentType: "application/json", sizeBytes: 10 }, true],
    [{ name: "a", contentType: "image/svg+xml", sizeBytes: 10 }, true],
    [{ name: "a.pdf", contentType: "application/pdf", sizeBytes: 10 }, false],
    [{ name: ".env", contentType: "", sizeBytes: 10 }, false],
    [{ name: "big.txt", contentType: "text/plain", sizeBytes: 300_000 }, false],
  ])("%j: %s", (entry, previewable) => {
    expect(isPreviewable(entry)).toBe(previewable);
  });
});
