import { cleanup, render, screen } from "@testing-library/react";
import {
  File,
  FileArchive,
  FileSpreadsheet,
  FileText,
  FileVideoCamera,
  Folder,
  Image,
} from "lucide-react";
import { afterEach, describe, expect, it } from "vitest";
import { FileName, iconFor, splitExtension } from "./FileName";

afterEach(cleanup);

describe("splitExtension", () => {
  it.each([
    ["report.pdf", "report", ".pdf"],
    ["report.final.pdf", "report.final", ".pdf"],
    ["archive.tar.zst", "archive.tar", ".zst"],
    ["Meeting w. Bob", "Meeting w. Bob", ""],
    [".env", ".env", ""],
    ["README", "README", ""],
    ["trailing.", "trailing.", ""],
    ["photo.HEIC", "photo", ".HEIC"],
    ["data.toolongext", "data.toolongext", ""],
    ["data.abcdefgh", "data", ".abcdefgh"],
  ])("%j is %j and %j", (name, stem, extension) => {
    expect(splitExtension(name)).toEqual([stem, extension]);
  });
});

describe("iconFor", () => {
  it.each([
    ["Drafts.md", "folder", Folder],
    ["notes.md", "file", FileText],
    ["server.LOG", "file", FileText],
    ["budget.xlsx", "file", FileSpreadsheet],
    ["IMG_0001.heic", "file", Image],
    ["clip.MOV", "file", FileVideoCamera],
    ["backup.zst", "file", FileArchive],
    ["program.exe", "file", File],
    ["LICENSE", "file", File],
  ] as const)("%s, a %s, has its own picture", (name, kind, icon) => {
    expect(iconFor(name, kind)).toBe(icon);
  });
});

describe("FileName", () => {
  it.each([
    ["Quarterly report.pdf", "file", ["Quarterly report", ".pdf"]],
    ["notes.v2", "folder", ["notes.v2"]],
    ["LICENSE", "file", ["LICENSE"]],
  ] as const)("shows %s, a %s, as %j and names it once", (name, kind, shown) => {
    const { container } = render(<FileName name={name} kind={kind} />);
    const hidden = container.querySelector('[aria-hidden="true"]:not(svg)');
    expect([...(hidden?.children ?? [])].map((part) => part.textContent)).toEqual(shown);
    // The whole name reaches assistive technology once, outside the hidden boxes.
    expect(
      screen.getAllByText(name).filter((node) => node.closest("[aria-hidden]") === null),
    ).toHaveLength(1);
    expect(container.querySelector("svg")).not.toBeNull();
  });

  it("can leave out the picture of its kind", () => {
    const { container } = render(<FileName name="a.txt" kind="file" hasIcon={false} />);
    expect(container.querySelector("svg")).toBeNull();
  });
});
