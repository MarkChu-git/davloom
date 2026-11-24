import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, apiFetch } from "./client";
import { DavError, removeEntry, transferEntry } from "./dav";
import { needsStepUp, requestStepUp, setStepUpHandler, withStepUp } from "./stepUp";

// Step-up verification as every request of the Dashboard meets it: a refusal with
// verification_required asks the installed dialog, and the request runs once more after it.

const REFUSED = () => Response.json({ error: { code: "verification_required" } }, { status: 403 });

let answers: (() => Response)[];
let sent: string[];
let remove: (() => void) | undefined;

beforeEach(() => {
  sent = [];
  answers = [];
  vi.stubGlobal("location", { origin: "https://dav.example" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init: RequestInit) => {
      sent.push(`${init.method ?? "GET"} ${url}`);
      return (answers.shift() ?? (() => Response.json({ ok: true })))();
    }),
  );
});

afterEach(() => {
  remove?.();
  remove = undefined;
  vi.unstubAllGlobals();
});

describe("needsStepUp", () => {
  it.each([
    [new ApiError(403, "verification_required"), true],
    [new DavError(403, "verification_required"), true],
    [new ApiError(403, "forbidden"), false],
    [new ApiError(401, "verification_required"), false],
    [new DavError(403), false],
    [new Error("verification_required"), false],
    [null, false],
    ["verification_required", false],
  ])("%o needs a step-up: %s", (error, expected) => {
    expect(needsStepUp(error)).toBe(expected);
  });
});

describe("withStepUp", () => {
  it("runs once when nothing asks for verification", async () => {
    const handler = vi.fn(async () => true);
    remove = setStepUpHandler(handler);
    const run = vi.fn(async () => "done");

    expect(await withStepUp(run)).toBe("done");
    expect(run).toHaveBeenCalledTimes(1);
    expect(handler).not.toHaveBeenCalled();
  });

  it("asks, and runs again once the person verified", async () => {
    remove = setStepUpHandler(async () => true);
    answers = [REFUSED];

    expect(await apiFetch("/api/keys", { method: "POST", body: {} })).toEqual({ ok: true });
    expect(sent).toEqual(["POST /api/keys", "POST /api/keys"]);
  });

  it("lets the refusal stand when the person cancels", async () => {
    remove = setStepUpHandler(async () => false);
    answers = [REFUSED];

    await expect(apiFetch("/api/export", { method: "POST" })).rejects.toMatchObject({
      status: 403,
      code: "verification_required",
    });
    expect(sent).toEqual(["POST /api/export"]);
  });

  it("asks only once, and refuses again when the second try is refused too", async () => {
    const handler = vi.fn(async () => true);
    remove = setStepUpHandler(handler);
    answers = [REFUSED, REFUSED];

    await expect(apiFetch("/api/export", { method: "POST" })).rejects.toMatchObject({
      code: "verification_required",
    });
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("shows one dialog for requests refused at the same time", async () => {
    let finish: ((verified: boolean) => void) | undefined;
    const handler = vi.fn(
      () =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    remove = setStepUpHandler(handler);
    const first = requestStepUp();
    const second = requestStepUp();
    finish?.(true);

    expect(await Promise.all([first, second])).toEqual([true, true]);
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it("answers false without a dialog", async () => {
    expect(await requestStepUp()).toBe(false);
    answers = [REFUSED];
    await expect(apiFetch("/api/export", { method: "POST" })).rejects.toBeInstanceOf(ApiError);
  });

  it("removes only its own dialog", async () => {
    const first = setStepUpHandler(async () => true);
    remove = setStepUpHandler(async () => false);
    first();

    expect(await requestStepUp()).toBe(false);
  });

  it("asks before WebDAV deletes and replacing copies run again", async () => {
    remove = setStepUpHandler(async () => true);
    answers = [REFUSED];
    await removeEntry(["files", "a.txt"], "file");
    answers = [REFUSED];
    await transferEntry("copy", ["files", "a.txt"], ["files", "b.txt"], "file");

    expect(sent).toEqual([
      "DELETE /dav/files/a.txt",
      "DELETE /dav/files/a.txt",
      "COPY /dav/files/a.txt",
      "COPY /dav/files/a.txt",
    ]);
  });

  it("reads a WebDAV refusal's code, and keeps other refusals as they are", async () => {
    remove = setStepUpHandler(async () => false);
    answers = [REFUSED];
    await expect(removeEntry(["files", "a.txt"], "file")).rejects.toEqual(
      new DavError(403, "verification_required"),
    );
    answers = [() => new Response("no", { status: 403 })];
    await expect(removeEntry(["files", "a.txt"], "file")).rejects.toEqual(new DavError(403));
  });
});
