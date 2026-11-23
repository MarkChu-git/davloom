import * as fc from "fast-check";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearFinished,
  startUploads,
  UPLOAD_LIMIT_BYTES,
  uploadNameProblem,
  uploadProblem,
  type Upload,
} from "./uploadStore";

// The limit stands in for the Cloud Free request body limit, which the platform enforces.
describe("upload size", () => {
  it.each([
    [0, false],
    [UPLOAD_LIMIT_BYTES, false],
    [UPLOAD_LIMIT_BYTES + 1, true],
    [150_000_000, true],
  ])("a file of %d bytes is refused: %s", (sizeBytes, isRefused) => {
    expect(uploadProblem(sizeBytes) !== undefined).toBe(isRefused);
  });

  it("a file is refused exactly when it is over 100 MB", () => {
    // Sizes near the limit, where an off-by-one would show, and sizes anywhere up to twice it.
    const size = fc.oneof(
      fc.integer({ min: UPLOAD_LIMIT_BYTES - 3, max: UPLOAD_LIMIT_BYTES + 3 }),
      fc.integer({ min: 0, max: 2 * UPLOAD_LIMIT_BYTES }),
    );
    fc.assert(
      fc.property(size, (sizeBytes) => {
        expect(uploadProblem(sizeBytes) !== undefined).toBe(sizeBytes > 100_000_000);
      }),
    );
  });

  it("a file cannot take a folder's name", () => {
    expect(uploadNameProblem("Drafts", new Set(["Drafts"]))).toContain("folder named");
    expect(uploadNameProblem("notes.md", new Set(["Drafts"]))).toBeUndefined();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  clearFinished();
});

/** A stand-in for XMLHttpRequest that stores every file except one named "refused.txt". */
class FakeRequest {
  status = 0;
  private url = "";
  private readonly listeners = new Map<string, () => void>();
  readonly upload = { addEventListener: () => undefined };
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader() {}
  addEventListener(type: string, listener: () => void) {
    this.listeners.set(type, listener);
  }
  send() {
    this.status = this.url.endsWith("refused.txt") ? 507 : 201;
    queueMicrotask(() => this.listeners.get("load")?.());
  }
}

const settled = (path: string, files: File[], folders: string[] = []) =>
  new Promise<Upload[]>((resolve) => startUploads(path, files, new Set(folders), resolve));

describe("uploads", () => {
  it("reports every file's outcome once the last one ends, in the order given", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeRequest);
    const outcomes = await settled(
      "/files",
      [new File(["a"], "a.txt"), new File(["b"], "refused.txt"), new File(["c"], "Drafts")],
      ["Drafts"],
    );
    expect(outcomes.map(({ name, state }) => `${name} ${state}`)).toEqual([
      "a.txt done",
      "refused.txt failed",
      "Drafts failed",
    ]);
    expect(outcomes[1]?.problem).toBe("The storage backend is full.");
    expect(outcomes[0]?.sentBytes).toBe(1);
  });

  it("a file that cannot be read, as a dropped folder, fails before any request", async () => {
    const open = vi.fn();
    vi.stubGlobal(
      "XMLHttpRequest",
      class extends FakeRequest {
        override open(method: string, url: string) {
          open();
          super.open(method, url);
        }
      },
    );
    const unreadable = new File([], "Photos");
    const part = new Blob(["x"]);
    vi.spyOn(part, "arrayBuffer").mockRejectedValue(
      new DOMException("not readable", "NotReadableError"),
    );
    vi.spyOn(unreadable, "slice").mockReturnValue(part);
    const [outcome] = await settled("/files", [unreadable]);
    expect(outcome?.state).toBe("failed");
    expect(outcome?.problem).toContain("folder");
    expect(open).not.toHaveBeenCalled();
  });
});
