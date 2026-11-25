import * as fc from "fast-check";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { webdavAddress } from "../api/dav";
import { LOCALES, type Locale } from "../i18n/locale";
import { translator, type Translator } from "../i18n/translate";
import { formatBytes, formatCount } from "../shell/format";
import {
  FILL_SCRIPT,
  FRAME_PARSED_SCRIPT,
  FRAME_WORDS,
  type FrameOverview,
  fillFrame,
  frameTexts,
} from "./fill";

/** The tiles' texts as the Dashboard's own translator writes them. */
const pageTexts = (t: Translator, { usage, mounts, backends }: FrameOverview) => {
  const hasKnownCapacity = backends.some(
    (backend) => typeof backend.capacity === "number" && backend.capacity > 0,
  );
  return {
    stored: t.bytes(usage.bytes),
    "stored-caption": t("overview.storedCaption", {
      files: t("count.files", { count: usage.files }),
      folders: t("count.folders", { count: usage.collections }),
    }),
    mounts: t.count(mounts.length),
    "mounts-caption": t("overview.mountsCaption", {
      used: new Set(mounts.map((mount) => mount.backendId)).size,
      backends: t("count.backends", { count: backends.length }),
    }),
    ...(hasKnownCapacity
      ? {}
      : {
          capacity: t("overview.noFixedLimit"),
          "capacity-caption": t("overview.bytesStored", { bytes: t.bytes(usage.bytes) }),
        }),
  };
};

const locales = fc.constantFrom<Locale>(...LOCALES);

const bytes = fc.oneof(
  fc.nat(),
  fc.integer({ min: 0, max: Number.MAX_SAFE_INTEGER }),
  fc.double({ min: 0, max: 1e16, noNaN: true }),
  fc.constantFrom(0, 1, 999, 1000, 1e6 - 1, 1e6, 1e9, 1e12, 1e15),
);

const overviews: fc.Arbitrary<FrameOverview> = fc.record({
  usage: fc.record({ bytes, files: fc.nat(), collections: fc.nat() }),
  mounts: fc.array(fc.record({ backendId: fc.constantFrom("a", "b", "c") }), { maxLength: 6 }),
  backends: fc.array(
    fc.record({
      capacity: fc.option(fc.oneof(fc.constant(0), fc.integer({ min: -5, max: 1e12 })), {
        nil: undefined,
      }),
      usage: fc.option(fc.record({ bytes }), { nil: null }),
    }),
    { maxLength: 4 },
  ),
});

describe("the frame's formatters", () => {
  it("format bytes as format.ts does", () => {
    fc.assert(
      fc.property(bytes, (value) => {
        for (const locale of LOCALES) {
          expect(frameTexts.formatBytes(value, locale)).toBe(formatBytes(value, locale));
        }
      }),
    );
  });

  it("format counts as format.ts does", () => {
    fc.assert(
      fc.property(fc.oneof(fc.nat(), fc.integer()), (value) => {
        for (const locale of LOCALES) {
          expect(frameTexts.formatCount(value, locale)).toBe(formatCount(value, locale));
        }
      }),
    );
  });

  it("write the overview's tiles as the Dashboard's translator does, in either language", () => {
    fc.assert(
      fc.property(overviews, locales, (overview, locale) => {
        expect(frameTexts.overviewTexts(overview, locale)).toEqual(
          pageTexts(translator(locale), overview),
        );
      }),
    );
  });

  it("write the overview's tiles in Chinese", () => {
    expect(frameTexts.overviewTexts(OVERVIEW, "zh-CN")).toMatchObject({
      "stored-caption": "1 个文件，分布在 3 个文件夹中",
      capacity: translator("zh-CN")("overview.noFixedLimit"),
    });
  });

  it.each([
    ["/", null, ["/api/overview"]],
    ["/", "profile", ["/api/overview"]],
    ["/settings", null, ["/api/me"]],
    ["/settings/", "profile", ["/api/me"]],
    ["/settings", "appearance", []],
    ["/files", null, []],
    ["/sign-in", null, []],
  ])("name what the frame at %s (section %s) reads", (path, section, expected) => {
    expect(frameTexts.framePaths(path, section)).toEqual(expected);
  });

  it("write the WebDAV address as the page does", () => {
    expect(frameTexts.webdavAddress(location.origin)).toBe(webdavAddress());
    fc.assert(
      fc.property(fc.webUrl({ withQueryParameters: false, withFragments: false }), (url) => {
        const { origin } = new URL(url);
        expect(frameTexts.webdavAddress(origin)).toBe(`${origin}/dav/`);
      }),
    );
  });

  it("start the profile's fields as the profile form does", () => {
    fc.assert(
      fc.property(
        fc.string(),
        fc.option(fc.string(), { nil: null }),
        fc.option(fc.string(), { nil: null }),
        (name, username, email) => {
          expect(frameTexts.profileValues({ name, username, email })).toEqual({
            name,
            username: username ?? "",
            email: email ?? "",
          });
        },
      ),
    );
  });
});

const OVERVIEW: FrameOverview = {
  usage: { bytes: 1_234_567, files: 1, collections: 3 },
  mounts: [{ backendId: "a" }, { backendId: "a" }],
  backends: [{ capacity: null, usage: { bytes: 1_234_567 } }],
};

const USER = { id: "u", name: "Ada", username: "ada", email: null };

const TILES = `
  <span data-frame-placeholder="stored"></span><span data-frame-slot="stored" hidden></span>
  <span data-frame-placeholder="stored-caption"></span><span data-frame-slot="stored-caption" hidden></span>
  <span data-frame-placeholder="capacity"></span><span data-frame-slot="capacity" hidden></span>
  <span data-frame-placeholder="mounts"></span><span data-frame-slot="mounts" hidden></span>
`;

const FIELDS = `
  <input data-frame-slot="profile-name" />
  <label data-frame-slot="profile-username"><input /></label>
  <input data-frame-slot="profile-email" value="kept" />
`;

/** Answers each path with its body, or with 401 for a path it does not know. */
const answer = (bodies: Record<string, unknown>) => {
  const fetch = vi.fn(async (path: string) =>
    path in bodies
      ? new Response(JSON.stringify(bodies[path]), { status: 200 })
      : new Response(JSON.stringify({ code: "unauthenticated" }), { status: 401 }),
  );
  vi.stubGlobal("fetch", fetch);
  return fetch;
};

/**
 * Runs the inline script on its own, as the browser does. Istanbul's coverage counters live
 * outside the function, so under `test:coverage` its source cannot run alone, and the function
 * itself runs instead.
 */
const isInstrumented = /\bcov_\w+/.test(FILL_SCRIPT);

/** Compiles an inline script's source on its own, as the browser does, without running it. */
const compile = (source: string): (() => unknown) => {
  // oxlint-disable-next-line typescript/no-implied-eval -- the test runs the script as the browser does
  const script = new Function(source);
  return () => Reflect.apply(script, undefined, []);
};

const runScript = isInstrumented
  ? () => fillFrame(undefined, FRAME_WORDS)
  : () => compile(FILL_SCRIPT)();

/** Runs the frame's script at `path` over the frame `html`. */
const run = (path: string, html: string, { inert = true } = {}) => {
  window.history.replaceState(null, "", path);
  document.body.innerHTML = html;
  document.body.toggleAttribute("inert", inert);
  runScript();
  return window.davloomFrameReads ?? {};
};

/** Lets the read and the writes after it settle. */
const settle = async (reads: Record<string, Promise<unknown>>) => {
  await Promise.allSettled(Object.values(reads));
  await new Promise((resolve) => setTimeout(resolve, 0));
};

const text = (slot: string) => document.querySelector(`[data-frame-slot="${slot}"]`);

beforeEach(() => {
  document.body.innerHTML = "";
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.documentElement.removeAttribute("lang");
  document.body.removeAttribute("inert");
  window.history.replaceState(null, "", "/");
});

describe("the frame's script", () => {
  it.skipIf(isInstrumented)("refers to nothing outside its own source", () => {
    expect(FILL_SCRIPT).toMatch(/^\(function fillFrame\(/);
    expect(() => compile(FILL_SCRIPT)).not.toThrow();
  });

  it("writes the overview's figures into the tiles and drops their skeletons", async () => {
    const fetch = answer({ "/api/overview": OVERVIEW });
    const reads = run("/", TILES);
    expect(fetch).toHaveBeenCalledWith("/api/overview", { credentials: "same-origin" });
    await settle(reads);
    await expect(reads["/api/overview"]).resolves.toEqual(OVERVIEW);
    expect(text("stored")?.textContent).toBe("1.2 MB");
    expect(text("stored")?.hasAttribute("hidden")).toBe(false);
    expect(text("stored-caption")?.textContent).toBe("1 file in 3 folders");
    expect(text("capacity")?.textContent).toBe("No fixed limit");
    expect(text("mounts")?.textContent).toBe("2");
    expect(document.querySelectorAll("[data-frame-placeholder]")).toHaveLength(0);
  });

  it("writes them in the language <html> names", async () => {
    document.documentElement.lang = "zh-CN";
    answer({ "/api/overview": OVERVIEW });
    const reads = run("/", TILES);
    await settle(reads);
    expect(text("stored-caption")?.textContent).toBe("1 个文件，分布在 3 个文件夹中");
    expect(text("capacity")?.textContent).toBe(translator("zh-CN")("overview.noFixedLimit"));
  });

  it("leaves the skeleton of a tile that draws a meter", async () => {
    answer({
      "/api/overview": { ...OVERVIEW, backends: [{ capacity: 10e6, usage: { bytes: 1e6 } }] },
    });
    const reads = run("/", TILES);
    await settle(reads);
    expect(text("capacity")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelector('[data-frame-placeholder="capacity"]')).not.toBeNull();
    expect(text("stored")?.textContent).toBe("1.2 MB");
  });

  it("writes the whole WebDAV address on every page, without a read", async () => {
    const fetch = answer({});
    const reads = run("/files", '<input data-frame-slot="webdav-address" value="/dav/" />');
    expect(fetch).not.toHaveBeenCalled();
    await settle(reads);
    expect(document.querySelector("input")?.value).toBe(`${location.origin}/dav/`);
  });

  it("fills the profile's fields on Settings", async () => {
    const fetch = answer({ "/api/me": USER });
    const reads = run("/settings", FIELDS);
    expect(fetch).toHaveBeenCalledWith("/api/me", { credentials: "same-origin" });
    await settle(reads);
    const inputs = [...document.querySelectorAll("input")].map((input) => input.value);
    expect(inputs).toEqual(["Ada", "ada", ""]);
  });

  it.each(["/settings?section=profile", "/settings/"])("reads the profile at %s", (path) => {
    const fetch = answer({ "/api/me": USER });
    run(path, FIELDS);
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it.each(["/settings?section=appearance", "/files", "/sign-in", "/credentials"])(
    "reads nothing at %s",
    (path) => {
      const fetch = answer({});
      const reads = run(path, TILES + FIELDS);
      expect(fetch).not.toHaveBeenCalled();
      expect(reads).toEqual({});
    },
  );

  it("writes nothing when the visitor is signed out", async () => {
    answer({});
    const reads = run("/", TILES);
    await settle(reads);
    await expect(reads["/api/overview"]).rejects.toThrow("401");
    expect(text("stored")?.hasAttribute("hidden")).toBe(true);
    expect(document.querySelectorAll("[data-frame-placeholder]")).toHaveLength(4);
  });

  it("writes nothing when the read fails on the way", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Promise.reject(new TypeError("offline"))),
    );
    const reads = run("/settings", FIELDS);
    await settle(reads);
    expect([...document.querySelectorAll("input")].map((input) => input.value)).toEqual([
      "",
      "",
      "kept",
    ]);
  });

  it("writes nothing over a page React has already rendered", async () => {
    answer({ "/api/overview": OVERVIEW });
    const reads = run("/", TILES, { inert: false });
    await settle(reads);
    expect(text("stored")?.textContent).toBe("");
  });

  it("writes nothing for an answer it cannot read", async () => {
    answer({ "/api/overview": { usage: null } });
    const reads = run("/", TILES);
    await settle(reads);
    expect(text("stored")?.textContent).toBe("");
  });

  it("waits for the frame to be parsed before writing", async () => {
    answer({ "/api/overview": OVERVIEW });
    const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const reads = run("/", TILES);
    await settle(reads);
    expect(text("stored")?.textContent).toBe("");
    state.mockRestore();
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(text("stored")?.textContent).toBe("1.2 MB");
  });

  it("writes as soon as the end of the frame says it has been parsed", async () => {
    answer({ "/api/overview": OVERVIEW });
    const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const reads = run("/", TILES);
    await settle(reads);
    expect(text("stored")?.textContent).toBe("");
    compile(FRAME_PARSED_SCRIPT)();
    expect(text("stored")?.textContent).toBe("1.2 MB");
    // DOMContentLoaded, which comes later, writes nothing again.
    text("stored")!.textContent = "";
    document.dispatchEvent(new Event("DOMContentLoaded"));
    expect(text("stored")?.textContent).toBe("");
    state.mockRestore();
  });

  it("writes an answer that arrives after the frame was parsed at once", async () => {
    const { promise, resolve: arrive } = Promise.withResolvers<Response>();
    vi.stubGlobal(
      "fetch",
      vi.fn(() => promise),
    );
    const state = vi.spyOn(document, "readyState", "get").mockReturnValue("loading");
    const reads = run("/", TILES);
    compile(FRAME_PARSED_SCRIPT)();
    expect(text("stored")?.textContent).toBe("");
    arrive(new Response(JSON.stringify(OVERVIEW)));
    await settle(reads);
    expect(text("stored")?.textContent).toBe("1.2 MB");
    state.mockRestore();
  });
});
