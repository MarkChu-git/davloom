declare global {
  interface Window {
    /** The reads the frame's script started, by API path, for prefetch.ts to hand to the page. */
    davloomFrameReads?: Record<string, Promise<unknown>>;
    /** Called by FRAME_PARSED_SCRIPT once the frame has been parsed. */
    davloomFrameParsed?: () => void;
  }
}

/** What the frame shows of the overview: what OverviewPage reads of it. */
export interface FrameOverview {
  usage: { bytes: number; files: number; collections: number };
  mounts: readonly { backendId: string }[];
  backends: readonly { capacity?: number | null; usage?: { bytes: number } | null }[];
}

/** What the frame shows of the signed-in owner. */
export interface FrameUser {
  name: string;
  username: string | null;
  email: string | null;
}

/** The texts the frame writes, from the function that writes them. */
export interface FrameFormatters {
  formatBytes: (bytes: number) => string;
  formatCount: (count: number) => string;
  plural: (count: number, one: string, many: string) => string;
  /** The tiles' texts by slot; none for a tile that draws a meter. */
  overviewTexts: (overview: FrameOverview) => Record<string, string>;
  profileValues: (user: FrameUser) => Record<"name" | "username" | "email", string>;
  /** The WebDAV address at `origin`, as features/api/dav.ts writes it. */
  webdavAddress: (origin: string) => string;
  /** The API paths the frame of the page at `path` reads, `section` being its section parameter. */
  framePaths: (path: string, section: string | null) => readonly string[];
}

/**
 * The script each prerendered page carries inline in its <head> (`FILL_SCRIPT`, __root.tsx). It
 * starts the API reads whose answers the page shows first, before any of the page's code has
 * loaded, and writes the values into the frame's slots as text the moment they arrive, formatted
 * as the page formats them, so the browser paints the real figures right after the API answers.
 * React then renders the page over the frame, from the same answers (prefetch.ts takes them from
 * `window.davloomFrameReads`), so nothing is read twice. Signed out, or when a read fails, it
 * writes nothing, and the page's own reads say why.
 *
 * The browser runs this function's source on its own, so it refers to nothing outside its body
 * but the browser's globals. With `mode` "formatters" it returns its formatters and writes
 * nothing, which the tests compare with the page's own (fill.test.ts).
 */
export function fillFrame(mode: "formatters"): FrameFormatters;
export function fillFrame(): undefined;
// The browser runs the body alone, so every helper stays inside it.
/* oxlint-disable unicorn/consistent-function-scoping */
export function fillFrame(mode?: "formatters"): FrameFormatters | undefined {
  const LOCALE = "en";
  const UNITS = [
    ["byte", 1],
    ["kilobyte", 1e3],
    ["megabyte", 1e6],
    ["gigabyte", 1e9],
    ["terabyte", 1e12],
  ] as const;
  // As features/shell/format.ts formats them.
  const formatBytes = (bytes: number): string => {
    const [unit, size] = UNITS.findLast(([, step]) => bytes >= step) ?? UNITS[0];
    return new Intl.NumberFormat(LOCALE, {
      style: "unit",
      unit,
      unitDisplay: unit === "byte" ? "long" : "short",
      maximumFractionDigits: unit === "byte" ? 0 : 1,
    }).format(bytes / size);
  };
  const formatCount = (count: number): string => new Intl.NumberFormat(LOCALE).format(count);
  // As features/overview/OverviewPage.tsx formats them.
  const plural = (count: number, one: string, many: string): string =>
    `${formatCount(count)} ${count === 1 ? one : many}`;

  /** The tiles' texts, as OverviewPage's Tiles writes them; none for a tile with a meter. */
  const overviewTexts = (overview: FrameOverview): Record<string, string> => {
    const { usage, mounts, backends } = overview;
    const texts: Record<string, string> = {
      stored: formatBytes(usage.bytes),
      "stored-caption": `${plural(usage.files, "file", "files")} in ${plural(usage.collections, "folder", "folders")}`,
      mounts: formatCount(mounts.length),
      "mounts-caption": `On ${new Set(mounts.map((mount) => mount.backendId)).size} of ${plural(backends.length, "backend", "backends")}`,
    };
    const known = backends.filter(
      (backend) => typeof backend.capacity === "number" && backend.capacity > 0,
    );
    // A known capacity draws a meter, which only the page itself draws.
    if (known.length === 0) {
      texts.capacity = "No fixed limit";
      texts["capacity-caption"] = `${formatBytes(usage.bytes)} stored`;
    }
    return texts;
  };

  /** The profile form's values, as ProfileForm starts them. */
  const profileValues = (user: FrameUser): Record<"name" | "username" | "email", string> => ({
    name: user.name,
    username: user.username ?? "",
    email: user.email ?? "",
  });

  const webdavAddress = (origin: string): string => `${origin}/dav/`;

  /** What the frame of each page shows first: the overview's tiles, the profile's fields. */
  const framePaths = (path: string, section: string | null): readonly string[] => {
    const page = path.replace(/\/+$/, "") || "/";
    if (page === "/") return ["/api/overview"];
    if (page === "/settings" && (section === null || section === "profile")) return ["/api/me"];
    return [];
  };

  if (mode === "formatters") {
    return {
      formatBytes,
      formatCount,
      plural,
      overviewTexts,
      profileValues,
      webdavAddress,
      framePaths,
    };
  }

  const reads: Record<string, Promise<unknown>> = {};
  window.davloomFrameReads = reads;
  const read = <T>(path: string): Promise<T> => {
    const answer = fetch(path, { credentials: "same-origin" }).then((response) =>
      response.ok
        ? // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the API's own answer for this path
          (response.json() as Promise<T>)
        : Promise.reject(new Error(String(response.status))),
    );
    reads[path] = answer;
    return answer;
  };
  // The frame has been parsed once the inline script at the end of <body> (FRAME_PARSED_SCRIPT)
  // runs. DOMContentLoaded would come only after the page's module scripts have run, which is the
  // wait this script is here to spare.
  let isParsed = document.readyState !== "loading";
  const waiting: (() => void)[] = [];
  const parsed = () => {
    if (isParsed) return;
    isParsed = true;
    for (const run of waiting.splice(0)) run();
  };
  window.davloomFrameParsed = parsed;
  document.addEventListener("DOMContentLoaded", parsed, { once: true });
  /** Runs `write` with the answer once the frame has been parsed, and never lets a failure out. */
  const once = <T>(answer: Promise<T>, write: (value: T) => void) => {
    answer.then(
      (value) => {
        const run = () => {
          // Once React has rendered the page over the frame, the page shows the value itself.
          if (!document.body.hasAttribute("inert")) return;
          try {
            write(value);
          } catch {
            // The page renders the value itself.
          }
        };
        if (isParsed) run();
        else waiting.push(run);
      },
      () => undefined,
    );
  };
  /** The frame's text slots and their placeholders, by name. */
  const slots = (name: string) => document.querySelectorAll(`[data-frame-slot="${name}"]`);
  const placeholders = (name: string) =>
    document.querySelectorAll(`[data-frame-placeholder="${name}"]`);

  const writeOverview = (overview: FrameOverview) => {
    for (const [name, text] of Object.entries(overviewTexts(overview))) {
      for (const slot of slots(name)) {
        slot.textContent = text;
        slot.removeAttribute("hidden");
      }
      for (const placeholder of placeholders(name)) placeholder.remove();
    }
  };
  const writeProfile = (user: FrameUser) => {
    for (const [name, value] of Object.entries(profileValues(user))) {
      for (const slot of slots(`profile-${name}`)) {
        const input = slot instanceof HTMLInputElement ? slot : slot.querySelector("input");
        if (input !== null) input.value = value;
      }
    }
  };
  // The address needs no read: the frame was prerendered without the origin it is served from.
  once(Promise.resolve(), () => {
    for (const slot of slots("webdav-address")) {
      const input = slot instanceof HTMLInputElement ? slot : slot.querySelector("input");
      if (input !== null) input.value = webdavAddress(location.origin);
    }
  });
  const section = new URLSearchParams(location.search).get("section");
  for (const apiPath of framePaths(location.pathname, section)) {
    if (apiPath === "/api/overview") once(read<FrameOverview>(apiPath), writeOverview);
    if (apiPath === "/api/me") once(read<FrameUser>(apiPath), writeProfile);
  }
  return undefined;
}
/* oxlint-enable unicorn/consistent-function-scoping */

/** The inline script for <head>: the function above, run once as the page's HTML is parsed. */
export const FILL_SCRIPT = `(${fillFrame.toString()})()`;

/** The inline script for the end of <body>, after the frame: tells FILL_SCRIPT it may write. */
export const FRAME_PARSED_SCRIPT = "window.davloomFrameParsed&&window.davloomFrameParsed()";

/**
 * The frame's texts, for the page to write the same values the same way once it renders.
 * OverviewPage's tiles take their texts from here, so the figures the frame paints are the ones
 * the page then shows.
 */
export const frameTexts: FrameFormatters = fillFrame("formatters");
