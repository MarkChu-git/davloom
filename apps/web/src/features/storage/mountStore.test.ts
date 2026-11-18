import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import { mountFolderOf, mountNameProblem } from "./mountStore";

// The law this stand-in shares with the server's Mount resolution (design.md Decision 2): a
// mount's folder is one path segment that no other mount uses.
describe("mount folder names", () => {
  const taken = ["/documents"];
  it.each([
    ["music", undefined],
    ["/music", undefined],
    ["music/", undefined],
    [" / My music.v2 ", undefined],
    ["doc", undefined],
    ["", "Enter a folder name."],
    ["/", "Enter a folder name."],
    ["a/b", "Use one folder name, without slashes."],
    [".", "Choose another folder name."],
    ["..", "Choose another folder name."],
    ["/ ..", "Choose another folder name."],
    ["documents", "Another mount already uses this folder."],
    ["/ documents", "Another mount already uses this folder."],
  ])("%j gives %j", (name, problem) => {
    expect(mountNameProblem(name, taken)).toBe(problem);
  });

  it.each([
    ["music", "music"],
    [" / music ", "music"],
    ["//music/", "music"],
    [" / My music.v2 ", "My music.v2"],
    [" / My  music ", "My  music"],
  ])("%j takes the folder %j", (name, folder) => {
    expect(mountFolderOf(name)).toBe(folder);
  });

  it("drops no-break spaces around a name as well", () => {
    expect(mountFolderOf("\u00A0/music\u00A0")).toBe("music");
  });

  it("strips the ends of a long name in linear time", () => {
    // A regex anchored at the end takes seconds on this name; stepping in from each end takes
    // well under a millisecond, so the limit leaves a wide margin for a slow machine.
    const inside = `a${" /".repeat(100_000)}b`;
    const started = performance.now();
    expect(mountFolderOf(` /${inside}/ `)).toBe(inside);
    expect(performance.now() - started).toBeLessThan(100);
  });

  it("a name is accepted exactly when its folder is one segment with no space at either end, not a dot segment, and not in use", () => {
    // What a user might type before and after a folder name, around any short name.
    const typed = fc
      .tuple(
        fc.constantFrom("", " ", "/", "//", "/ ", " / ", "/\u00A0"),
        fc.string({ unit: fc.constantFrom("a", ".", "/", " "), maxLength: 4 }),
        fc.constantFrom("", " ", "/", "\u00A0"),
      )
      .map((parts) => parts.join(""));
    fc.assert(
      fc.property(
        typed,
        fc.uniqueArray(fc.constantFrom<string>("/a", "/aa", "/a.a"), { maxLength: 3 }),
        (name, paths) => {
          const folder = mountFolderOf(name);
          const isValid =
            folder !== "" &&
            !folder.includes("/") &&
            folder.trim() === folder &&
            folder !== "." &&
            folder !== ".." &&
            !paths.includes(`/${folder}`);
          expect(mountNameProblem(name, paths) === undefined).toBe(isValid);
        },
      ),
    );
  });
});
