import { expect, test, type Locator, type Page } from "@playwright/test";
import {
  api,
  createKey,
  createMount,
  LONG_LOG_NAME,
  SAMPLE_NAMES,
  scratchFolder,
  unique,
  WORKERS_ORIGIN,
} from "./instances";
import {
  PREVIEW,
  filesAt,
  withUnavailableBackend,
  blockClipboard,
  boxOf,
  cardWith,
  levelOne,
  onScreen,
  openList,
  placeholderRows,
  selectFirstRow,
  shown,
  sideNavigation,
  sidewaysOverflow,
} from "./helpers";

// The Dashboard: its pages, how they are reached, the colors they render, and how they lay out,
// against the Worker's real API. Tests that change data change their own: a folder, a key or a
// mount named for the test alone (instances.ts).
const PAGES = [
  { path: "/", name: "Overview" },
  { path: "/files", name: "Files" },
  { path: "/credentials", name: "Credentials" },
  { path: "/storage", name: "Storage & Mounts" },
  { path: "/settings", name: "Settings" },
] as const;

interface PageState {
  name: string;
  /** The page's address, or a function that prepares what the page shows and returns it. */
  path: string | ((page: Page) => Promise<string>);
  /** A window width other than the default 1280 px. */
  width?: number;
  /** Runs before the page opens, for example to hold back an answer so a passing state stays. */
  before?: (page: Page) => Promise<void>;
  show: (page: Page) => Promise<void>;
  /** Checks, after the scan, that the page still shows the passing state the scan read. */
  still?: (page: Page) => Promise<void>;
}

/** A folder of the test's own with the sample in it, opened on Files. */
const sampleFolder = async (page: Page): Promise<string> =>
  filesAt(await scratchFolder(page.request));

/** A key of the test's own on Credentials, so the list has a row whatever the other tests do. */
const withKey = async (page: Page): Promise<string> => {
  await createKey(page.request, unique("Scan key"));
  return "/credentials";
};

/** A mount of the test's own on Storage & Mounts. */
const withMount =
  (name: string) =>
  async (page: Page): Promise<string> => {
    // The light and the dark scans share the mount, so the second finds it made.
    await createMount(page.request, name).catch(() => undefined);
    return "/storage";
  };

/** Holds every WebDAV listing back, so a folder stays loading. */
const holdListings = async (page: Page) => {
  await page.route("**/dav/**", (route) =>
    route.request().method() === "PROPFIND" ? new Promise(() => undefined) : route.continue(),
  );
};

/** Holds uploads back, so an upload stays in progress. */
const holdUploads = async (page: Page) => {
  await page.route("**/dav/**", (route) =>
    route.request().method() === "PUT" ? new Promise(() => undefined) : route.continue(),
  );
};

const SCAN_MOUNT = unique("scan");

/**
 * The page states the scan covers: each page and Settings section, the dialogs, menus, option
 * lists and confirmations the pages open, the details dialog and the navigation menu of narrower
 * windows, and what components show only on focus, on hover, while they work or when they fail:
 * keyboard focus, a tooltip, notifications, warnings, field errors, a checked switch, empty
 * states, a loading listing, a failed listing, upload progress and finished uploads, row
 * selection, and a backend that does not answer.
 */
const STATES: readonly PageState[] = [
  {
    name: "Overview",
    path: "/",
    show: (page) => shown(page.getByRole("img", { name: "Bytes stored on each backend" })),
  },
  {
    name: "Overview with copying blocked",
    path: "/",
    show: async (page) => {
      await blockClipboard(page);
      await page.getByRole("button", { name: "Copy address" }).click();
      await shown(onScreen(page, /This browser blocked copying here/));
    },
  },
  {
    name: "Overview with keyboard focus",
    path: "/",
    show: async (page) => {
      await shown(page.getByRole("heading", { name: "Connections" }));
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus-visible")).toHaveCount(1);
    },
  },
  {
    name: "Overview with a chart's tooltip",
    path: "/",
    show: async (page) => {
      await page.getByRole("img", { name: "Bytes stored on each backend" }).hover();
      await shown(page.getByRole("status", { name: /Stored/ }));
    },
    still: (page) => shown(page.getByRole("status", { name: /Stored/ })),
  },
  {
    name: "Overview with a backend that does not answer",
    path: "/",
    before: withUnavailableBackend,
    show: (page) => shown(page.getByText("Unavailable", { exact: true }).first()),
  },
  {
    name: "Overview that cannot be read",
    path: "/",
    before: async (page) => {
      await page.route("**/api/overview", (route) => route.fulfill({ status: 500 }));
    },
    show: (page) => shown(page.getByText("Cannot read the overview")),
  },
  {
    name: "the folded side navigation, with a backend that does not answer",
    path: "/",
    before: withUnavailableBackend,
    show: async (page) => {
      await sideNavigation(page).getByRole("button", { name: "Collapse sidebar" }).click();
      await shown(
        sideNavigation(page).getByRole("link", { name: "Storage & Mounts, 1 backend unavailable" }),
      );
    },
  },
  {
    name: "the top level of Files",
    path: "/files",
    show: (page) => shown(page.getByRole("link", { name: "files", exact: true })),
  },
  {
    name: "a folder while it loads",
    path: sampleFolder,
    before: holdListings,
    show: async (page) => {
      await expect(levelOne(page)).toHaveText("Files");
      await expect(placeholderRows(page)).toHaveCount(15);
    },
    still: async (page) => {
      await expect(placeholderRows(page)).toHaveCount(15);
      await expect(page.getByRole("row")).toHaveCount(0);
    },
  },
  {
    name: "a file's preview",
    path: PREVIEW,
    show: async (page) => {
      await shown(page.getByRole("link", { name: "wifi-guest.txt" }));
      await shown(page.getByRole("heading", { name: "Preview" }));
    },
  },
  {
    name: "a file's details in a dialog",
    path: PREVIEW,
    width: 1024,
    show: (page) => shown(page.getByRole("dialog").getByRole("heading", { name: "Preview" })),
  },
  {
    name: "a folder that cannot be listed",
    path: sampleFolder,
    before: async (page) => {
      await page.route("**/dav/**", (route) =>
        route.request().method() === "PROPFIND" ? route.fulfill({ status: 503 }) : route.continue(),
      );
    },
    show: (page) => shown(onScreen(page, /^Cannot list /)),
  },
  {
    name: "a folder that does not exist",
    path: filesAt("/files/missing-folder"),
    show: (page) => shown(page.getByRole("heading", { name: "This folder does not exist" })),
  },
  {
    name: "a search that matches nothing",
    path: sampleFolder,
    show: async (page) => {
      await shown(page.getByRole("row").nth(1));
      await page.getByRole("searchbox", { name: "Search this folder" }).fill("zzz");
      await shown(page.getByRole("heading", { name: "Nothing here matches “zzz”" }));
    },
  },
  {
    name: "selected rows",
    path: sampleFolder,
    show: async (page) => {
      await selectFirstRow(page);
      await shown(page.getByRole("button", { name: "Move" }));
    },
  },
  {
    name: "a row's menu",
    path: sampleFolder,
    show: async (page) => {
      await page
        .getByRole("button", { name: /^Actions for / })
        .first()
        .click();
      await shown(page.getByRole("menu"));
    },
  },
  {
    name: "the New folder dialog",
    path: sampleFolder,
    show: async (page) => {
      await page.getByRole("button", { name: "New folder" }).click();
      const name = page.getByRole("dialog").getByLabel("Name");
      await expect(name).toBeFocused();
      await name.pressSequentially("Rec");
    },
  },
  {
    name: "the Move dialog with a refused destination",
    path: sampleFolder,
    show: async (page) => {
      await selectFirstRow(page);
      await page.getByRole("button", { name: "Move" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Move" }).click();
      await shown(onScreen(page, "Choose another folder than the one they are in."));
    },
  },
  {
    name: "the Delete confirmation",
    path: sampleFolder,
    show: async (page) => {
      await selectFirstRow(page);
      await page.getByRole("button", { name: "Delete" }).click();
      await shown(page.getByRole("alertdialog"));
    },
  },
  {
    name: "an upload in progress",
    path: sampleFolder,
    before: holdUploads,
    show: async (page) => {
      await shown(page.getByRole("row").nth(1));
      await page.getByRole("button", { name: "Upload" }).click();
      await page.locator('input[type="file"]').setInputFiles({
        name: "scan.pdf",
        mimeType: "application/pdf",
        buffer: Buffer.alloc(2_000_000),
      });
      await shown(page.getByRole("progressbar", { name: "Uploading scan.pdf" }));
    },
    still: (page) => shown(page.getByRole("progressbar", { name: "Uploading scan.pdf" })),
  },
  {
    name: "a finished upload and a refused one",
    path: sampleFolder,
    show: async (page) => {
      await shown(page.getByRole("row").nth(1));
      await page.getByRole("button", { name: "Upload" }).click();
      await page.locator('input[type="file"]').setInputFiles([
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes") },
        // A folder of this name is already here, so the upload is refused.
        { name: "Drafts", mimeType: "text/plain", buffer: Buffer.from("Drafts") },
      ]);
      await shown(onScreen(page, /^Uploaded to \/files\//));
      await shown(onScreen(page, /A folder named “Drafts” is already here/));
    },
  },
  {
    name: "Credentials",
    path: withKey,
    show: (page) => shown(page.getByRole("button", { name: /^Actions for key / }).first()),
  },
  {
    name: "a key's menu",
    path: withKey,
    show: async (page) => {
      await page
        .getByRole("button", { name: /^Actions for key / })
        .first()
        .click();
      await shown(page.getByRole("menu"));
    },
  },
  {
    name: "the Create key form with a field error and a checked switch",
    path: "/credentials",
    show: async (page) => {
      await page.getByRole("button", { name: "Create key" }).first().click();
      await page.getByRole("dialog").getByRole("switch", { name: "Read only" }).check();
      await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
      await shown(onScreen(page, "Name the key after the device or person that will use it."));
    },
  },
  {
    name: "a new key, shown once",
    path: "/credentials",
    show: async (page) => {
      await page.getByRole("button", { name: "Create key" }).first().click();
      await page.getByRole("dialog").getByLabel("Name").fill("Work laptop");
      await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
      await shown(page.getByRole("heading", { name: "Key “Work laptop” is ready" }));
    },
  },
  {
    name: "the Create key dialog with its Expires list open",
    path: "/credentials",
    show: async (page) => {
      await page.getByRole("button", { name: "Create key" }).first().click();
      await openList(page, "combobox", "Expires");
    },
  },
  {
    name: "the Revoke confirmation",
    path: withKey,
    show: async (page) => {
      await page
        .getByRole("button", { name: /^Actions for key / })
        .first()
        .click();
      await page.getByRole("menuitem", { name: "Revoke" }).click();
      await shown(page.getByRole("alertdialog"));
    },
  },
  {
    name: "Storage & Mounts",
    path: "/storage",
    show: (page) => shown(page.getByRole("heading", { level: 3, name: "Default" })),
  },
  {
    name: "Storage & Mounts with a backend that does not answer",
    path: "/storage",
    before: withUnavailableBackend,
    show: (page) => shown(onScreen(page, "Unavailable").first()),
  },
  {
    name: "a mount's menu",
    path: "/storage",
    show: async (page) => {
      await page.getByRole("button", { name: "Actions for mount /files" }).click();
      await shown(page.getByRole("menu"));
    },
  },
  {
    name: "the Add mount dialog with a list open",
    path: "/storage",
    show: async (page) => {
      await page.getByRole("button", { name: "Add mount" }).click();
      await openList(page, "combobox", "Backend");
    },
  },
  {
    name: "the Add backend dialog with a field error",
    path: "/storage",
    show: async (page) => {
      await page.getByRole("button", { name: "Add backend" }).click();
      await page.getByRole("dialog").getByRole("button", { name: "Add backend" }).click();
      await shown(onScreen(page, "Enter a name for the backend."));
    },
  },
  {
    name: "the Remove mount confirmation",
    path: withMount(SCAN_MOUNT),
    show: async (page) => {
      await page.getByRole("button", { name: `Actions for mount /${SCAN_MOUNT}` }).click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      await shown(page.getByRole("alertdialog"));
    },
  },
  {
    name: "Profile settings",
    path: "/settings?section=profile",
    show: (page) => shown(page.getByText("Administrator")),
  },
  {
    name: "Sign-in and security settings",
    path: "/settings?section=security",
    show: (page) => shown(page.getByRole("main").getByRole("button", { name: "Sign out" })),
  },
  {
    name: "WebDAV settings",
    path: "/settings?section=webdav",
    show: (page) => shown(page.getByRole("button", { name: "Copy address" })),
  },
  {
    name: "Appearance settings",
    path: "/settings?section=appearance",
    show: (page) => shown(page.getByRole("radio", { name: "System" })),
  },
  {
    name: "About this instance",
    path: "/settings?section=about",
    show: (page) => shown(page.getByText("Cloudflare Durable Objects")),
  },
  {
    name: "Credentials as a list in a narrow window, with two keys open",
    path: async (page) => {
      await createKey(page.request, unique("Narrow one"));
      await createKey(page.request, unique("Narrow two"));
      return "/credentials";
    },
    width: 375,
    show: async (page) => {
      const toggles = page.getByRole("button", { name: /^Details for key / });
      await toggles.nth(0).click();
      await toggles.nth(1).click();
      await shown(page.getByRole("main").getByRole("button", { name: "Revoke" }).first());
    },
  },
  {
    name: "Storage & Mounts in the narrowest window, with a mount open",
    path: "/storage",
    width: 320,
    show: async (page) => {
      await page.getByRole("button", { name: "Details for mount /files" }).click();
      await shown(page.getByRole("main").getByRole("button", { name: "Remove" }));
    },
  },
  {
    name: "the navigation dropdown in a narrow window",
    path: "/",
    width: 375,
    show: async (page) => {
      await page.getByRole("button", { name: "Menu" }).click();
      await shown(page.getByRole("dialog", { name: "Menu" }).getByRole("link", { name: "Files" }));
    },
  },
  {
    name: "the Settings section list in a window 1024 px wide",
    path: "/settings?section=profile",
    width: 1024,
    show: (page) => openList(page, "combobox", "Section", page),
  },
];

// Runs in the page: whether the theme painted the body dark, so the scan covers the intended mode.
const bodyIsDark = (): boolean => {
  const [red = 255] = (getComputedStyle(document.body).backgroundColor.match(/[\d.]+/g) ?? []).map(
    Number,
  );
  return red < 128;
};

// Runs in the page: the colors the theme's status tokens resolve to in the mode in use, as the
// browser reports them, in rgb() or rgba(). Statuses are the only parts of a page with a hue.
const statusColorsOnPage = (): string[] => {
  const probe = document.createElement("span");
  document.body.append(probe);
  const colors: string[] = [];
  for (const status of ["error", "warning", "success", "info"]) {
    for (const token of [
      `--color-${status}`,
      `--color-text-${status}`,
      `--color-icon-${status}`,
      `--color-border-${status}`,
      `--color-on-${status}`,
      `--color-${status}-muted`,
      `--color-on-${status}-muted`,
    ]) {
      probe.style.color = `var(${token})`;
      colors.push(getComputedStyle(probe).color);
    }
    probe.style.boxShadow = `var(--shadow-inset-${status})`;
    colors.push(getComputedStyle(probe).boxShadow);
  }
  probe.style.color = "var(--color-background-error-inverted)";
  colors.push(getComputedStyle(probe).color);
  probe.remove();
  return colors;
};

// Runs in the page: every color that an element or one of its pseudo-elements paints with a hue,
// apart from the status colors in `allowed`. It reads colors inside shadows, filters, gradients and
// SVG data URLs too, including the color names an SVG uses. An RGB color is a gray when its
// channels differ by at most 1 in 255, the rounding that color mixing leaves; a Lab or LCH color
// when its chroma is as small. An RGB color, in rgb() or color(srgb), is a status color when each
// channel is within 1 in 255 of one of `allowed`, whatever its alpha. A notation it does not
// parse, such as XYZ, counts as a hue, and so does `accent-color: auto`, which leaves checkboxes
// and radio buttons to the browser's own blue.
const huesOnPage = (allowed: readonly string[]): string[] => {
  const properties = [
    "color",
    "background-color",
    "background-image",
    "border-top-color",
    "border-right-color",
    "border-bottom-color",
    "border-left-color",
    "border-image-source",
    "outline-color",
    "column-rule-color",
    "text-decoration-color",
    "text-emphasis-color",
    "-webkit-text-fill-color",
    "-webkit-text-stroke-color",
    "-webkit-tap-highlight-color",
    "caret-color",
    "accent-color",
    "scrollbar-color",
    "box-shadow",
    "text-shadow",
    "filter",
    "backdrop-filter",
    "fill",
    "stroke",
    "stop-color",
    "flood-color",
    "lighting-color",
    "mask-image",
    "list-style-image",
    "content",
  ];
  const pseudoElements = [
    null,
    "::before",
    "::after",
    "::marker",
    "::placeholder",
    "::selection",
    "::backdrop",
    "::file-selector-button",
    "::spelling-error",
    "::grammar-error",
  ];
  // The names of grays, and words an SVG paints with that are not colors of their own.
  const grayNames = new Set([
    "black",
    "white",
    "gray",
    "grey",
    "silver",
    "gainsboro",
    "whitesmoke",
    "dimgray",
    "dimgrey",
    "darkgray",
    "darkgrey",
    "lightgray",
    "lightgrey",
    "transparent",
    "none",
    "currentcolor",
    "inherit",
    "context-fill",
    "context-stroke",
  ]);
  // RGB spaces whose gray has equal channels; XYZ is not one of them.
  const rgbSpaces = new Set([
    "srgb",
    "srgb-linear",
    "display-p3",
    "a98-rgb",
    "prophoto-rgb",
    "rec2020",
  ]);
  // `page.evaluate` sends only this function's source to the browser, so every helper lives here.
  const hasHue = (notation: string, parts: readonly string[]): boolean => {
    // color() names its space first; the other notations start with their channels.
    const [space = "", ...channels] = notation === "color" ? parts : ["", ...parts];
    const [x = 0, y = 0, z = 0] = channels.map((part) =>
      part === "none" ? 0 : Number.parseFloat(part),
    );
    switch (notation) {
      case "rgb":
      case "rgba":
        return Math.max(x, y, z) - Math.min(x, y, z) > 1;
      case "color":
        return !rgbSpaces.has(space) || Math.max(x, y, z) - Math.min(x, y, z) > 1 / 255;
      case "lab":
        return Math.hypot(y, z) > 0.5;
      case "lch":
        return y > 0.5;
      case "oklab":
        return Math.hypot(y, z) > 0.002;
      case "oklch":
        return y > 0.002;
      default:
        return true;
    }
  };
  const statusChannels = allowed.flatMap((value) =>
    [...value.matchAll(/rgba?\(([^()]*)\)/g)].map(([, body = ""]) =>
      body
        .split(/[\s,/]+/)
        .filter((part) => part !== "")
        .slice(0, 3)
        .map(Number),
    ),
  );
  // A relative color, such as rgb(from …), computes to color(srgb), whose channels run from 0 to 1,
  // so they are scaled to the 0 to 255 of rgb() first.
  const isStatusColor = (notation: string, parts: readonly string[]): boolean => {
    let channels: number[];
    if (notation === "rgb" || notation === "rgba") {
      channels = parts.slice(0, 3).map(Number);
    } else if (notation === "color" && parts[0] === "srgb") {
      channels = parts.slice(1, 4).map((part) => Math.round(Number.parseFloat(part) * 255));
    } else {
      return false;
    }
    return statusChannels.some((status) =>
      status.every((level, at) => Math.abs(level - (channels[at] ?? Number.NaN)) <= 1),
    );
  };
  const found = new Set<string>();
  for (const element of document.querySelectorAll("*")) {
    for (const pseudoElement of pseudoElements) {
      const style = getComputedStyle(element, pseudoElement);
      for (const property of properties) {
        const raw = style.getPropertyValue(property);
        const where = `${property}${pseudoElement ?? ""}: `;
        // Only elements draw controls, and highlight pseudo-elements never inherit the property.
        if (property === "accent-color" && pseudoElement === null && raw === "auto") {
          found.add(`${where}auto`);
        }
        // A data URL may percent-encode what it holds, such as # as %23. Each escape is read on
        // its own, so a percentage elsewhere in the value leaves the rest readable.
        const value = raw.replaceAll(/%([\da-f]{2})/gi, (_escape, hex: string) =>
          String.fromCodePoint(Number.parseInt(hex, 16)),
        );
        for (const [literal, notation = "", body = ""] of value.matchAll(
          /\b(rgba?|color|oklab|oklch|lab|lch|hsla?|hwb)\(([^()]*)\)/g,
        )) {
          const parts = body.split(/[\s,/]+/).filter((part) => part !== "");
          if (hasHue(notation, parts) && !isStatusColor(notation, parts)) {
            found.add(where + literal);
          }
        }
        if (value.includes("url(")) {
          for (const [literal, hex = ""] of value.matchAll(
            /(?:#|%23)([\da-f]{8}|[\da-f]{6}|[\da-f]{3,4})(?![\da-f])/gi,
          )) {
            const full = hex.length <= 4 ? hex.replaceAll(/./g, "$&$&") : hex;
            const channels = [0, 2, 4].map((at) =>
              String(Number.parseInt(full.slice(at, at + 2), 16)),
            );
            if (hasHue("rgb", channels)) {
              found.add(where + literal);
            }
          }
          // A word followed by ( names a function, such as rgb() or url(), which the readers
          // above take; a name may hold hyphens, as context-fill does.
          for (const [literal, name = ""] of value.matchAll(
            /(?:fill|stroke|stop-color|flood-color|lighting-color|color)\s*[:=]\s*["']?([a-z][a-z-]*)(?![a-z(-])/gi,
          )) {
            if (!grayNames.has(name.toLowerCase())) {
              found.add(where + literal);
            }
          }
        }
      }
    }
  }
  return [...found];
};

for (const scheme of ["light", "dark"] as const) {
  for (const { name, path, width, before, show, still } of STATES) {
    test(`Rendered pages: ${name} shows no hue but the status colors in ${scheme} mode`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: scheme });
      if (width !== undefined) {
        await page.setViewportSize({ width, height: 900 });
      }
      await before?.(page);
      await page.goto(typeof path === "string" ? path : await path(page));
      await show(page);

      expect(await page.evaluate(bodyIsDark)).toBe(scheme === "dark");
      // A border or fill on its way to a status color passes through blends of the old color and
      // the new one, which are not status colors, so the scan waits for transitions to end.
      await page.evaluate(() =>
        Promise.all(
          document
            .getAnimations()
            .filter((animation) => animation instanceof CSSTransition)
            .map((animation) => animation.finished.catch(() => undefined)),
        ),
      );
      const allowed = await page.evaluate(statusColorsOnPage);
      expect(await page.evaluate(huesOnPage, allowed)).toEqual([]);
      await still?.(page);
    });
  }
}

/** Puts `css` and `html` on the page, scans it, and takes them away again. */
const scanWith = async (page: Page, { css = "", html = "" }: { css?: string; html?: string }) => {
  await page.evaluate(
    (sample) => {
      const style = document.createElement("style");
      style.id = "scan-sample-style";
      style.textContent = sample.css;
      document.head.append(style);
      const holder = document.createElement("div");
      holder.id = "scan-sample-html";
      holder.innerHTML = sample.html;
      document.querySelector('[role="main"]')?.prepend(holder);
    },
    { css, html },
  );
  const found = await page.evaluate(huesOnPage, await page.evaluate(statusColorsOnPage));
  await page.evaluate(() => {
    document.querySelector("#scan-sample-style")?.remove();
    document.querySelector("#scan-sample-html")?.remove();
  });
  return found;
};

const svgImage = (shapes: string) =>
  `h1 { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E${shapes}%3C/svg%3E"); }`;

// Colors put on a page on purpose. The hues sit in places and notations that task 1.3 lists, one
// of them in a notation the scan does not parse, and the grays and a status color must pass.
const SCAN_SAMPLES: readonly { name: string; css?: string; html?: string; hasHue: boolean }[] = [
  {
    name: "a Lab selection",
    css: "h1::selection { background-color: lab(50 40 30); }",
    hasHue: true,
  },
  {
    name: "a shadow on ::after",
    css: "h1::after { content: 'x'; box-shadow: 0 0 2px rgb(255 0 0); }",
    hasHue: true,
  },
  {
    name: "a red placeholder",
    css: "input::placeholder { color: rgb(255 0 0); }",
    html: "<input placeholder='Name'>",
    hasHue: true,
  },
  {
    name: "a red file button",
    css: "input::file-selector-button { color: rgb(255 0 0); }",
    html: "<input type='file'>",
    hasHue: true,
  },
  {
    name: "a drop-shadow filter",
    css: "h1 { filter: drop-shadow(0 0 2px rgb(255 0 0)); }",
    hasHue: true,
  },
  {
    name: "an OKLCH gradient",
    css: "h1 { background-image: linear-gradient(oklch(0.6 0.2 30), white); }",
    hasHue: true,
  },
  {
    name: "a Display P3 text shadow",
    css: "h1 { text-shadow: 0 0 2px color(display-p3 1 0 0); }",
    hasHue: true,
  },
  { name: "an HWB color", css: "h1 { color: hwb(120 10% 10%); }", hasHue: true },
  { name: "an SVG color name", css: svgImage("%3Crect fill='red'/%3E"), hasHue: true },
  {
    name: "an SVG color name in percent-encoded quotes",
    css: svgImage("%3Crect fill=%27red%27/%3E"),
    hasHue: true,
  },
  {
    name: "an SVG 8-digit hex value",
    css: svgImage("%3Crect fill='%23ff000080'/%3E"),
    hasHue: true,
  },
  { name: "an SVG color function", css: svgImage("%3Crect fill='rgb(255,0,0)'/%3E"), hasHue: true },
  {
    name: "an XYZ color, which the scan does not parse",
    css: "h1 { color: color(xyz 0.5 0.5 0.5); }",
    hasHue: true,
  },
  { name: "a gray in color()", css: "h1 { color: color(srgb 0.5 0.5 0.5); }", hasHue: false },
  // A gray's channels may differ by 1 in 255, the rounding color mixing leaves, and no more.
  { name: "a gray one step apart", css: "h1 { color: rgb(128 128 129); }", hasHue: false },
  { name: "a color two steps apart", css: "h1 { color: rgb(128 128 130); }", hasHue: true },
  {
    name: "a gray one step apart in color()",
    css: "h1 { color: color(srgb 0.5 0.5 0.5039); }",
    hasHue: false,
  },
  {
    name: "a color two steps apart in color()",
    css: "h1 { color: color(srgb 0.5 0.5 0.5078); }",
    hasHue: true,
  },
  { name: "the error color", css: "h1 { color: var(--color-text-error); }", hasHue: false },
  // A status color may be off by 1 in 255 in each channel. Relative colors compute to color(srgb),
  // so these test that allowance in that notation; the test below tests it in rgb().
  {
    name: "the error color as a relative color",
    css: "h1 { color: rgb(from var(--color-text-error) r g b); }",
    hasHue: false,
  },
  {
    name: "a relative red one step from the error color",
    css: "h1 { color: rgb(from var(--color-text-error) r g calc(b + 1)); }",
    hasHue: false,
  },
  {
    name: "a relative red two steps from the error color",
    css: "h1 { color: rgb(from var(--color-text-error) r g calc(b + 2)); }",
    hasHue: true,
  },
  {
    name: "a placeholder and a file button the browser draws",
    html: "<input placeholder='Name'><input type='file'>",
    hasHue: false,
  },
  {
    name: "SVG grays",
    css: svgImage(
      "%3Crect fill='rgb(128,128,128)' stroke='%23808080'/%3E%3Crect fill='context-fill' stroke='currentColor' style='stroke:darkgray'/%3E",
    ),
    hasHue: false,
  },
];

test("Rendered pages: the scan reports hues put on a page on purpose, and no grays or status colors", async ({
  page,
}) => {
  // Each sample scans the whole page again.
  test.slow();
  await page.goto("/");
  await expect(levelOne(page)).toHaveText("Overview");

  expect(await scanWith(page, {})).toEqual([]);
  for (const { name, css, html, hasHue } of SCAN_SAMPLES) {
    expect((await scanWith(page, { css, html })).length > 0, name).toBe(hasHue);
  }

  // The same steps in rgb(), the notation most computed colors take, from the error color as this
  // mode resolves it: one step is the rounding the scan forgives, two are a color of their own.
  const [red = 0, green = 0, blue = 0] =
    (await tokenColor(page, "--color-text-error")).match(/\d+/g)?.map(Number) ?? [];
  const stepped = (step: number) =>
    `h1 { color: rgb(${red} ${green} ${blue > 255 - step ? blue - step : blue + step}); }`;
  expect(await scanWith(page, { css: stepped(1) }), "a red one step from the error color").toEqual(
    [],
  );
  expect(
    (await scanWith(page, { css: stepped(2) })).length > 0,
    "a red two steps from the error color",
  ).toBe(true);
});

for (const { path, name } of PAGES) {
  test(`Titles and headings: ${name} has its own title and one level-one heading`, async ({
    page,
  }) => {
    await page.goto(path);

    await expect(levelOne(page)).toHaveText(name);
    await expect(levelOne(page)).toHaveCount(1);
    await expect(page).toHaveTitle(`${name} | Davloom`);
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
}

test("Moving between pages: the side navigation changes the page without a reload", async ({
  page,
}) => {
  await page.goto("/");
  // A reload starts a new document, which has a new time origin.
  const origin = await page.evaluate(() => performance.timeOrigin);

  await sideNavigation(page).getByRole("link", { name: "Credentials" }).click();

  await expect(levelOne(page)).toHaveText("Credentials");
  await expect(sideNavigation(page).getByRole("link", { name: "Credentials" })).toHaveAttribute(
    "aria-current",
    "page",
  );
  expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);
});

/** The icon of the Storage & Mounts row, a drive, as Lucide names it. */
const driveIcon = (scope: Locator) => scope.locator("svg.lucide-hard-drive");

test("Storage status in the navigation: a backend that does not answer marks Storage & Mounts on every page", async ({
  page,
}) => {
  const navigation = sideNavigation(page);
  // While every backend answers, the row names no problem.
  await page.goto("/");
  await expect(levelOne(page)).toHaveText("Overview");
  await expect(
    navigation.getByRole("link", { name: "Storage & Mounts", exact: true }),
  ).toBeVisible();

  await withUnavailableBackend(page);
  for (const { path, name } of PAGES) {
    await page.goto(path);
    await expect(levelOne(page)).toHaveText(name);
    // The glyph's label joins the link's name, after the visible label.
    await expect(
      navigation.getByRole("link", { name: /^Storage & Mounts\s*1 backend unavailable$/ }),
      path,
    ).toBeVisible();
    await expect(
      navigation.getByRole("img", { name: "1 backend unavailable", exact: true }),
      path,
    ).toBeVisible();
  }

  // The rail draws only icons, so the glyph takes the row's icon and the status joins its name.
  await expect(
    driveIcon(navigation.getByRole("link", { name: /^Storage & Mounts\s*1 backend unavailable$/ })),
  ).toHaveCount(1);
  await navigation.getByRole("button", { name: "Collapse sidebar" }).click();
  const link = navigation.getByRole("link", { name: "Storage & Mounts, 1 backend unavailable" });
  await expect(link).toBeVisible();
  await expect(link.locator('[data-color="error"]')).toBeVisible();
  await expect(driveIcon(link)).toHaveCount(0);
  await link.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Storage & Mounts, 1 backend unavailable");
});

/**
 * Drags the side navigation's edge by `by` pixels and lets it go at rest. Astryx reads a pointer
 * that stood still for 40 ms before it lifted as one without velocity, so the edge settles where
 * it was let go instead of being flung on.
 */
const dragNavigationEdge = async (page: Page, by: number) => {
  const box = await page.getByRole("separator", { name: "Resize sidebar" }).boundingBox();
  if (box === null) {
    throw new Error("The resize handle has no box.");
  }
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + by, y, { steps: 8 });
  await page.waitForTimeout(100);
  await page.mouse.up();
};

test("Resizing the side navigation: its edge resizes it between 200 and 400 px and folds it to the rail under 160 px", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = sideNavigation(page);
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const expand = navigation.getByRole("button", { name: "Expand sidebar" });
  const size = async () => Number(await handle.getAttribute("aria-valuenow"));
  const width = async () => (await navigation.boundingBox())?.width ?? 0;
  await expect(handle).toHaveAttribute("aria-valuenow", "248");
  expect(await width()).toBe(248);

  // The edge also moves from the keyboard, as a separator does.
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const stepped = await size();
  expect(stepped).toBeGreaterThan(248);

  const drag = (by: number) => dragNavigationEdge(page, by);
  /** Lets the edge go where the navigation would be `target` pixels wide. */
  const dragTo = async (target: number) => drag(target - (await size()));

  await drag(80);
  await expect(handle).toHaveAttribute("aria-valuenow", String(stepped + 80));
  expect(await width()).toBe(stepped + 80);

  // The edge stops at the maximum.
  await drag(200);
  await expect(handle).toHaveAttribute("aria-valuenow", "400");
  expect(await width()).toBe(400);

  // Let go between 160 px and the minimum, the navigation comes back to the minimum.
  await dragTo(180);
  await expect(handle).toHaveAttribute("aria-valuenow", "200");
  expect(await width()).toBe(200);

  // Let go narrower than 160 px, it folds to its rail, and stays folded after a reload. It is
  // widened first, so the width it comes back to differs from the minimum.
  await dragTo(300);
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await dragTo(150);
  await expect(expand).toBeVisible();
  await expect(handle).toBeHidden();
  await page.reload();
  await expect(expand).toBeVisible();

  // Opening it again restores the width it had before folding, and Enter on the edge folds it.
  await expand.click();
  await expect(handle).toHaveAttribute("aria-valuenow", "300");
  await handle.focus();
  await page.keyboard.press("Enter");
  await expect(expand).toBeVisible();
});

const left = async (target: Locator): Promise<number> => {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error("A part of the side navigation has no box.");
  }
  return box.x;
};

test("One edge: the mark, the Manage heading, each link's icon and the collapse button line up", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = sideNavigation(page);
  const edges = [
    await left(navigation.getByText("Manage", { exact: true })),
    await left(navigation.getByRole("button", { name: "Collapse sidebar" }).locator("svg")),
  ];
  // The product name's link starts with the mark, and every other link with its icon.
  for (const link of await navigation.getByRole("link").all()) {
    edges.push(await left(link.locator("svg").first()));
  }
  expect(edges).toHaveLength(8);
  for (const edge of edges) {
    expect(edge).toBeCloseTo(edges[0] ?? Number.NaN, 0);
  }
});

// Runs in the page: where the page's content starts, the top of the first element after the title,
// at any level, that starts below the title's line. Actions beside the title start on its line.
const contentTop = (): number => {
  const title = document.querySelector('[role="main"] h1');
  const lineBottom = title?.parentElement?.getBoundingClientRect().bottom ?? Number.NaN;
  for (let node = title; node !== null && node !== undefined; node = node.parentElement) {
    for (let next = node.nextElementSibling; next !== null; next = next.nextElementSibling) {
      const { top } = next.getBoundingClientRect();
      if (top >= lineBottom) {
        return top;
      }
    }
  }
  return Number.NaN;
};

test("One grid: the mark and each page's title share a line, the first link starts where the page's content does, and the gutters match", async ({
  page,
}) => {
  for (const { path, name } of PAGES) {
    await page.goto(path);
    const navigation = sideNavigation(page);
    const mark = navigation.getByRole("link", { name: "Davloom" }).locator("svg").first();
    const title = levelOne(page);
    await shown(title);
    expect(await middleOf(title), name).toBeCloseTo(await middleOf(mark), 0);
    const firstLink = navigation.getByRole("link", { name: "Overview" });
    expect((await boxOf(firstLink)).y, name).toBeCloseTo(await page.evaluate(contentTop), 0);
    // The navigation's content starts as far in from the window's edge as the page's content starts
    // from the navigation, and its last control ends as far above the bottom.
    const { x: navX, width: navWidth } = await boxOf(navigation);
    const gutter = (await boxOf(title)).x - (navX + navWidth);
    expect((await boxOf(mark)).x, name).toBeCloseTo(gutter, 0);
    const collapse = await boxOf(navigation.getByRole("button", { name: "Collapse sidebar" }));
    const height = page.viewportSize()?.height ?? Number.NaN;
    expect(height - (collapse.y + collapse.height), name).toBeCloseTo(gutter, 0);
  }
});

test.describe("on a touch tablet", () => {
  test.use({ viewport: { width: 820, height: 1180 }, hasTouch: true });

  test("The title line on a touch screen: each page's title stays on the mark's line in the larger type", async ({
    page,
  }) => {
    for (const { path, name } of PAGES) {
      await page.goto(path);
      const title = levelOne(page);
      await shown(title);
      // The touch type scale is in use, so the title's own line is taller than the mark's row.
      expect((await boxOf(title)).height, name).toBeGreaterThan(32);
      const mark = sideNavigation(page)
        .getByRole("link", { name: "Davloom" })
        .locator("svg")
        .first();
      expect(await middleOf(title), name).toBeCloseTo(await middleOf(mark), 0);
    }
  });
});

test("Figures at two widths: the three headline figures sit side by side at 900 px and one above another at 800 px", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const figures = async () =>
    Promise.all(
      ["Stored", "Mounts", "Backends"].map(async (label) => {
        const box = await main
          .getByText(label, { exact: true })
          .and(page.locator('[data-type="label"]'))
          .boundingBox();
        if (box === null) {
          throw new Error(`The ${label} figure has no box.`);
        }
        return box;
      }),
    );

  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
  await shown(page.getByRole("img", { name: "Bytes stored on each backend" }));
  const [stored, capacity, mounts] = await figures();
  expect(capacity?.y).toBeCloseTo(stored?.y ?? Number.NaN, 0);
  expect(mounts?.y).toBeCloseTo(stored?.y ?? Number.NaN, 0);
  expect(stored?.x).toBeLessThan(capacity?.x ?? Number.NaN);
  expect(capacity?.x).toBeLessThan(mounts?.x ?? Number.NaN);

  // Too narrow for three, the row stacks all of them rather than wrapping two above one.
  await page.setViewportSize({ width: 800, height: 900 });
  const [narrowStored, narrowCapacity, narrowMounts] = await figures();
  expect(narrowCapacity?.x).toBeCloseTo(narrowStored?.x ?? Number.NaN, 0);
  expect(narrowMounts?.x).toBeCloseTo(narrowStored?.x ?? Number.NaN, 0);
  expect(narrowStored?.y).toBeLessThan(narrowCapacity?.y ?? Number.NaN);
  expect(narrowCapacity?.y).toBeLessThan(narrowMounts?.y ?? Number.NaN);
});

// Runs in the page: the height of the line an element's first words stand on. An empty box set in
// front of them on that line has its top there.
const baselineOf = (element: Element): number => {
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    if (node.textContent?.trim() && node.parentNode !== null) {
      const probe = document.createElement("span");
      probe.style.cssText = "display: inline-block; width: 0; height: 0; vertical-align: baseline";
      node.parentNode.insertBefore(probe, node);
      const { top } = probe.getBoundingClientRect();
      probe.remove();
      return top;
    }
  }
  return Number.NaN;
};

test("Figures on one grid: side by side, the tiles' labels, figures and captions each share a line", async ({
  page,
}) => {
  const labels = ["Stored", "Mounts", "Backends"];
  // The default width, and the narrowest that still sets the three side by side.
  for (const width of [1280, 900]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    await shown(page.getByRole("img", { name: "Bytes stored on each backend" }));
    const lines = await Promise.all(
      labels.map(async (label) => {
        const tile = cardWith(page, page.getByText(label, { exact: true }));
        const [labelPart, figure, caption] = await tile.locator(":scope > *").all();
        if (labelPart === undefined || figure === undefined || caption === undefined) {
          throw new Error(`The ${label} tile lacks a part.`);
        }
        const labelBox = await boxOf(labelPart);
        return {
          label: await labelPart.evaluate(baselineOf),
          figure: await figure.evaluate(baselineOf),
          caption: await caption.evaluate(baselineOf),
          gap: (await boxOf(figure)).y - labelBox.y - labelBox.height,
        };
      }),
    );
    for (const [index, line] of lines.entries()) {
      // A tile keeps its parts 4 px apart, the gap it had before it took the grid's rows, rather
      // than the 16 px between tiles.
      expect(line.gap, `${labels[index]}'s gap at ${width} px`).toBeCloseTo(4, 0);
      for (const part of ["label", "figure", "caption"] as const) {
        expect(line[part], `${labels[index]}'s ${part} at ${width} px`).toBeCloseTo(
          lines[0]?.[part] ?? Number.NaN,
          0,
        );
      }
    }
  }
});

test("Backend cards on one grid: with room, each status stands on its name's line, and side by side every part starts on a shared line", async ({
  page,
}) => {
  await api(page.request, "POST", "/api/backends", {
    name: unique("Photos"),
    kind: "durable-object",
  });
  // The first two cards sit in one row at both widths. At 1440 px each card has room for its
  // status beside its name; at 1280 px the status moves under the backend's kind.
  for (const width of [1440, 1280]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/storage");
    const headings = page.getByRole("main").getByRole("heading", { level: 3 });
    await expect.poll(() => headings.count()).toBeGreaterThan(1);
    const names = (await headings.allTextContents()).slice(0, 2);
    const lines = await Promise.all(
      names.map(async (name) => {
        const card = cardWith(page, page.getByRole("heading", { level: 3, name, exact: true }));
        return {
          top: (await boxOf(card)).y,
          title: await card.getByRole("heading", { level: 3 }).evaluate(baselineOf),
          status: await card.getByText(/^(Available|Unavailable)$/).evaluate(baselineOf),
          details: (await boxOf(card.getByText("Stored", { exact: true }))).y,
        };
      }),
    );
    for (const [index, line] of lines.entries()) {
      const where = `${names[index]} at ${width} px`;
      if (width === 1440) {
        expect(line.status, `${where}: status`).toBeCloseTo(line.title, 0);
      }
      for (const part of ["top", "title", "status", "details"] as const) {
        expect(line[part], `${where}: ${part}`).toBeCloseTo(lines[0]?.[part] ?? Number.NaN, 0);
      }
    }
  }
});

/** The height of an element's middle, to tell whether two elements share a row. */
const middleOf = async (target: Locator): Promise<number> => {
  const { y, height } = await boxOf(target);
  return y + height / 2;
};

/** Whether an element sits inside a window `width` px wide, sideways. The page may scroll down. */
const insideWindow = async (target: Locator, width: number): Promise<boolean> => {
  const box = await target.boundingBox();
  return box !== null && box.x >= 0 && box.x + box.width <= width;
};

/** The details a row's toggle opens, found by the id its `aria-controls` names. */
const detailsOf = async (toggle: Locator): Promise<Locator> => {
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const id = await toggle.getAttribute("aria-controls");
  if (id === null) {
    throw new Error("The row is closed.");
  }
  return toggle.page().locator(`[id="${id}"]`);
};

/** Waits two frames for a change to start its animations, then for every animation that ends. */
const settle = (page: Page): Promise<void> =>
  page.evaluate(async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const ending = document
      .getAnimations()
      .filter(
        (animation) => animation.effect?.getComputedTiming().endTime !== Number.POSITIVE_INFINITY,
      );
    await Promise.all(ending.map((animation) => animation.finished.catch(() => undefined)));
  });

/**
 * Runs in the page: where the row of `rowName` is on each frame, from before a tap on the chevron
 * labelled `chevronLabel` above it, which opens or closes that row, until a second later.
 */
const placesWhileToggling = async ({
  chevronLabel,
  rowName,
}: {
  chevronLabel: string;
  rowName: string;
}): Promise<number[]> => {
  const main = document.querySelector('[role="main"]');
  const chevron = [...(main?.querySelectorAll("button") ?? [])].find(
    (button) => button.getAttribute("aria-label") === chevronLabel,
  );
  const row = [...(main?.querySelectorAll("li") ?? [])].find((item) =>
    (item.textContent ?? "").startsWith(rowName),
  );
  if (chevron === undefined || row === undefined) {
    return [];
  }
  const places = [row.getBoundingClientRect().y];
  chevron.click();
  const until = performance.now() + 1000;
  while (performance.now() < until) {
    await new Promise((resolve) => requestAnimationFrame(resolve));
    places.push(row.getBoundingClientRect().y);
  }
  return places;
};

/** Runs in the page: the lines of visible text in each element, such as the rows of a list. */
const linesOf = (elements: Element[]): string[][] =>
  elements.map((element) => (element instanceof HTMLElement ? element.innerText.split("\n") : []));

/**
 * Runs in the page: the background a row draws behind itself, on the row or on one of its pseudo
 * elements, with its corner radius and how far the row stays inside the nearest element around
 * it that draws a background, such as its card; or null while it draws none.
 */
const pressedBackground = (row: Element): { radius: number; inset: number } | null => {
  // An element that paints no background computes it to transparent black.
  const unpainted = ["transparent", "rgba(0, 0, 0, 0)"];
  const painted = [null, "::before", "::after"]
    .map((pseudo) => getComputedStyle(row, pseudo))
    .find((style) => !unpainted.includes(style.backgroundColor));
  let around = row.parentElement;
  while (around !== null && unpainted.includes(getComputedStyle(around).backgroundColor)) {
    around = around.parentElement;
  }
  if (painted === undefined || around === null) {
    return null;
  }
  const inner = row.getBoundingClientRect();
  const outer = around.getBoundingClientRect();
  return {
    radius: Number.parseFloat(painted.borderTopLeftRadius),
    inset: Math.min(inner.left - outer.left, outer.right - inner.right),
  };
};

/** The column of a table's cell or header, counted from 0, or -1 for anything else. */
const columnOf = (element: Element): number =>
  element instanceof HTMLTableCellElement ? element.cellIndex : -1;

/** How far the page has scrolled down: the scroll of every element that holds `target`. */
const scrollOf = (target: Locator): Promise<number> =>
  target.evaluate((element) => {
    let total = 0;
    for (let node = element.parentElement; node !== null; node = node.parentElement) {
      total += node.scrollTop;
    }
    return total;
  });

/**
 * Watches the page for the storage chart's values on every frame and at every change to the page,
 * so values shown for a single frame count too. The function it returns stops watching and says
 * whether the values showed.
 */
const watchStoredValues = async (page: Page): Promise<() => Promise<boolean>> => {
  const watch = await page.evaluateHandle(() => {
    const state: { seen: boolean; stop: () => void } = { seen: false, stop: () => undefined };
    const note = () => {
      state.seen ||= [...document.querySelectorAll('[role="status"]')].some(
        (element) =>
          (element.getAttribute("aria-label") ?? "").includes("Stored: ") &&
          element.checkVisibility({ opacityProperty: true, visibilityProperty: true }),
      );
    };
    note();
    const observer = new MutationObserver(note);
    observer.observe(document, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    let frame = 0;
    const everyFrame = () => {
      note();
      frame = requestAnimationFrame(everyFrame);
    };
    frame = requestAnimationFrame(everyFrame);
    state.stop = () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
    return state;
  });
  return () =>
    watch.evaluate((state) => {
      state.stop();
      return state.seen;
    });
};

/** Waits for the page to draw a frame, as it does between the touch events of a moving finger. */
const nextFrame = (page: Page) =>
  page.evaluate(() => new Promise((resolve) => requestAnimationFrame(resolve)));

// Runs in the page: where an element's words end, sideways.
const wordsEnd = (element: Element): number => {
  const words = document.createRange();
  words.selectNodeContents(element);
  return words.getBoundingClientRect().right;
};

// WCAG 1.4.10 asks content to reflow to 320 px without scrolling sideways, narrower than any
// common phone.
const PHONE_WIDTH = 320;

test.describe(`in a window ${PHONE_WIDTH} px wide`, () => {
  test.use({ viewport: { width: PHONE_WIDTH, height: 780 } });

  test("Narrow screens: the navigation sits behind a Menu button and no page scrolls sideways", async ({
    page,
  }) => {
    const folder = await scratchFolder(page.request);
    for (const { path, name } of [
      ...PAGES,
      { path: filesAt(folder), name: "Files" },
      ...["security", "webdav", "about"].map((section) => ({
        path: `/settings?section=${section}`,
        name: "Settings",
      })),
      { path: filesAt(folder, "README.txt"), name: "Files" },
    ]) {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText(name);
      // Files lists a folder after a short pause, and the list is what could spill sideways.
      if (path.startsWith("/files")) {
        await shown(page.getByRole("row").nth(1));
      }

      await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
      await expect(sideNavigation(page)).toBeHidden();
      expect(await page.evaluate(sidewaysOverflow), path).toEqual([]);
    }

    // The file's details open in a dialog, which the main region's width does not include.
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Preview" })).toBeVisible();
    // The dialog grows into place, so it is measured once its entrance has finished.
    await dialog.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished),
      );
    });
    const box = await dialog.boundingBox();
    expect(box !== null && box.x >= 0 && box.x + box.width <= PHONE_WIDTH).toBe(true);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  });

  test("The Menu button: the navigation drops down from it, marks the page and closes on a choice", async ({
    page,
  }) => {
    await page.goto("/");
    const menu = page.getByRole("button", { name: "Menu" });
    const dropdown = page.getByRole("dialog", { name: "Menu" });
    await menu.click();
    await expect(menu).toHaveAttribute("aria-expanded", "true");
    await expect(dropdown.getByRole("link", { name: "Overview" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    // The side navigation's links, the storage alert with them.
    for (const name of ["Files", "Credentials", "Settings"]) {
      await expect(dropdown.getByRole("link", { name, exact: true })).toBeVisible();
    }
    await expect(dropdown.getByRole("link", { name: "Storage & Mounts" })).toBeVisible();
    await expect(dropdown.getByRole("button", { name: "Sign out" })).toBeVisible();
    // It hangs below the button, inside the window.
    const button = await menu.boundingBox();
    const panel = await dropdown.boundingBox();
    expect(
      button !== null &&
        panel !== null &&
        panel.y >= button.y + button.height &&
        panel.x >= 0 &&
        panel.x + panel.width <= PHONE_WIDTH,
    ).toBe(true);

    // A link changes the page without a reload, closes the dropdown and gives focus back to Menu.
    const origin = await page.evaluate(() => performance.timeOrigin);
    await dropdown.getByRole("link", { name: "Credentials" }).click();
    await expect(levelOne(page)).toHaveText("Credentials");
    await expect(dropdown).toBeHidden();
    await expect(menu).toBeFocused();
    expect(await page.evaluate(() => performance.timeOrigin)).toBe(origin);

    // Escape closes it as well.
    await menu.click();
    await expect(dropdown.getByRole("link", { name: "Credentials" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await page.keyboard.press("Escape");
    await expect(dropdown).toBeHidden();
    await expect(menu).toBeFocused();
  });

  test("The Menu button on the grid: its word ends on the gutter the page's content keeps, and so does its dropdown", async ({
    page,
  }) => {
    await page.goto("/");
    // The page's content starts as far in from the window's left edge as it ends from the right.
    const gutter = (await boxOf(levelOne(page))).x;
    const menu = page.getByRole("button", { name: "Menu" });
    const word = menu.getByText("Menu", { exact: true });
    expect(await word.evaluate(wordsEnd)).toBeCloseTo(PHONE_WIDTH - gutter, 0);

    await menu.click();
    const dropdown = page.getByRole("dialog", { name: "Menu" });
    await shown(dropdown);
    // It grows into place, so it is measured once its entrance has finished.
    await dropdown.evaluate(async (element) => {
      await Promise.all(
        element
          .getAnimations({ subtree: true })
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished),
      );
    });
    const { x, width } = await boxOf(dropdown);
    expect(x + width).toBeCloseTo(PHONE_WIDTH - gutter, 0);
    // The click focused the button. The bar scrolls sideways to show a focused button whole, which
    // would carry the word off the gutter if the button reached past the bar.
    expect(await word.evaluate(wordsEnd)).toBeCloseTo(PHONE_WIDTH - gutter, 0);
  });

  test("Buttons beside a title: they stay on its row and show only their icons where their words do not fit", async ({
    page,
  }) => {
    await page.goto("/storage");
    const add = page.getByRole("button", { name: "Add mount" });
    // A square button, its icon alone, level with the title.
    const narrow = await boxOf(add);
    expect(narrow.width).toBeCloseTo(narrow.height, 0);
    expect(await middleOf(add)).toBeCloseTo(await middleOf(levelOne(page)), -1);
    await add.hover();
    await expect(page.getByRole("tooltip")).toHaveText("Add mount");

    // With room for its words, the button shows them, still level with the title.
    await page.setViewportSize({ width: 414, height: 780 });
    await expect(add).toContainText("Add mount");
    expect((await boxOf(add)).width).toBeGreaterThan(narrow.width * 2);
    expect(await middleOf(add)).toBeCloseTo(await middleOf(levelOne(page)), -1);
  });
});

test.describe("in a window 1024 px wide", () => {
  test.use({ viewport: { width: 1024, height: 768 } });

  test("Tables beside the navigation: no page scrolls sideways, so every row's actions or chevron are in view", async ({
    page,
  }) => {
    const folder = await scratchFolder(page.request);
    const name = unique("Laptop (Finder)");
    await createKey(page.request, name);
    for (const { path, name: title } of [...PAGES, { path: filesAt(folder), name: "Files" }]) {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText(title);
      if (path.startsWith("/files")) {
        await shown(page.getByRole("row").nth(1));
      }
      expect(await page.evaluate(sidewaysOverflow), path).toEqual([]);
    }

    // Credentials lists each key as a row here, and gives each detail a column where there is room.
    await page.goto("/credentials");
    const chevrons = page.getByRole("main").getByRole("button", { name: /^Details for key / });
    const chevron = page.getByRole("main").getByRole("button", { name: `Details for key ${name}` });
    await shown(chevron);
    // The list may run below the window, so each chevron is checked sideways only.
    for (const each of await chevrons.all()) {
      expect(await insideWindow(each, 1024)).toBe(true);
    }
    await chevron.hover();
    await expect(page.getByRole("tooltip")).toHaveText(`Details for key ${name}`);
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 768 });
    await expect(page.getByRole("columnheader", { name: "Access" })).toBeVisible();
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  });
});

test.describe("in a window 375 px wide", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Sorting a narrow listing: a menu in the Name header's place sorts by name, size or time, either way", async ({
    page,
  }) => {
    const folder = await scratchFolder(page.request);
    await page.goto(filesAt(folder));
    const main = page.getByRole("main");
    await shown(main.getByRole("link", { name: "Contracts", exact: true }));
    await expect(main.getByRole("columnheader", { name: "Size" })).toHaveCount(0);
    const order = () =>
      main
        .getByRole("button", { name: /^Actions for / })
        .evaluateAll((buttons) =>
          buttons.map((button) =>
            (button.getAttribute("aria-label") ?? "").replace("Actions for ", ""),
          ),
        );
    // The menu stands where the Name header stood, at the head of the column of names, and its
    // button names the order in use.
    const header = (named: string) => main.getByRole("columnheader", { name: named });
    const menu = (named: string) => header(named).getByRole("button", { name: named });
    // The row's checkbox is labelled "Select Contracts", so the name's cell is the one it starts.
    const nameColumn = await main
      .getByRole("cell")
      .filter({ hasText: /^Contracts/ })
      .evaluate(columnOf);
    expect(nameColumn, "the column of names").toBeGreaterThanOrEqual(0);
    const inNameHeader = async (named: string) => {
      await expect(menu(named), "the sort menu in the Name header's place").toBeVisible();
      expect(await header(named).evaluate(columnOf), "the sort menu's column").toBe(nameColumn);
    };
    const sortBy = async (current: string, choice: string, next: string) => {
      await inNameHeader(current);
      await menu(current).click();
      await page.getByRole("menuitemradio", { name: choice }).click();
      await expect(menu(next)).toBeVisible();
    };
    const FOLDERS = SAMPLE_NAMES.slice(0, 4);
    const BY_NAME = SAMPLE_NAMES.slice(4);
    const BY_SIZE = [
      "meeting-notes-2026-11-14.md",
      "README.txt",
      "wifi-guest.txt",
      LONG_LOG_NAME,
      "Quarterly report — Q3 2026, final version (signed by both parties).pdf",
      "budget-2027.xlsx",
    ];
    // Folders of one size keep no order of their own among themselves.
    const foldersThenFiles = async (files: string[]) => {
      const names = await order();
      expect(names.slice(0, FOLDERS.length).toSorted()).toEqual(FOLDERS);
      expect(names.slice(FOLDERS.length)).toEqual(files);
    };

    await inNameHeader("Name, A to Z");
    expect(await order()).toEqual([...FOLDERS, ...BY_NAME]);
    await sortBy("Name, A to Z", "Z to A", "Name, Z to A");
    expect(await order()).toEqual([...FOLDERS.toReversed(), ...BY_NAME.toReversed()]);
    // A new key keeps the order's direction.
    await sortBy("Name, Z to A", "Size", "Size, largest first");
    await foldersThenFiles(BY_SIZE.toReversed());
    await sortBy("Size, largest first", "Smallest first", "Size, smallest first");
    await foldersThenFiles(BY_SIZE);
    // The sample was stored within a second or two, so times tie, and only the menu is checked.
    await sortBy("Size, smallest first", "Modified", "Modified, oldest first");
    await sortBy("Modified, oldest first", "Newest first", "Modified, newest first");
    const newestFirst = await order();

    // A wider window brings the columns back in the same order, which the Modified header shows.
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(main.getByRole("columnheader", { name: /Modified/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(await order()).toEqual(newestFirst);
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("Lists on a phone: each key and each mount is a row with its name and one line under it", async ({
    page,
  }) => {
    const KEYS = [unique("Phone"), unique("Laptop")];
    for (const name of KEYS) {
      await createKey(page.request, name);
    }
    const mountName = unique("photos");
    await createMount(page.request, mountName);
    await page.goto("/credentials");
    const main = page.getByRole("main");
    const keys = main.getByRole("listitem");
    for (const name of KEYS) {
      await shown(keys.filter({ hasText: name }));
    }
    // Once the keys are drawn as rows, no table is drawn beside them.
    await expect(page.getByRole("table")).toHaveCount(0);
    // A row shows a key's name, first characters and status, and the rest waits until it opens.
    for (const name of KEYS) {
      const [lines] = await keys.filter({ hasText: name }).evaluateAll(linesOf);
      expect(lines?.[0]).toBe(name);
      expect(lines?.[1]).toMatch(/^dav_\w+…$/);
      expect(lines?.[2]).toBe("Active");
    }
    for (const key of await keys.all()) {
      const toggle = key.getByRole("button", { name: /^Details for key / });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(await insideWindow(toggle, 375)).toBe(true);
    }
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);

    // Each name has a line of its own, so even the narrowest phone shows it whole in the larger
    // type of a touch screen. Under it, a key's first characters share a line with its status, and
    // the statuses end in one column.
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      // The page lays itself out for the new width two frames after the window changes, so the
      // rows are measured once it has.
      await settle(page);
      const ends = new Set<number>();
      for (const name of KEYS) {
        const key = keys.filter({ hasText: name });
        const where = `${name} at ${width} px`;
        const title = key.getByText(name, { exact: true });
        expect(
          await title.evaluate((element) => element.scrollWidth <= element.clientWidth),
          where,
        ).toBe(true);
        const titleBox = await boxOf(title);
        const prefix = await boxOf(key.getByText(/^dav_\w+…$/));
        const status = await boxOf(key.getByText("Active", { exact: true }));
        expect(prefix.y, where).toBeGreaterThanOrEqual(titleBox.y + titleBox.height - 1);
        expect(
          Math.abs(prefix.y + prefix.height / 2 - (status.y + status.height / 2)),
          where,
        ).toBeLessThanOrEqual(2);
        expect(status.x, where).toBeGreaterThan(prefix.x + prefix.width);
        ends.add(Math.round(status.x + status.width));
      }
      expect([...ends], `the statuses' ends at ${width} px`).toHaveLength(1);
    }
    await page.setViewportSize({ width: 375, height: 812 });

    await page.goto("/storage");
    const toggle = main.getByRole("button", { name: `Details for mount /${mountName}` });
    await shown(toggle);
    await expect(page.getByRole("table")).toHaveCount(0);
    // A mount's row shows its path and backend, and the rest waits until it opens.
    const [lines] = await main
      .getByRole("listitem")
      .filter({ hasText: `/${mountName}` })
      .evaluateAll(linesOf);
    expect(lines).toEqual([`/${mountName}`, "Default"]);
    for (const each of await main.getByRole("button", { name: /^Details for mount / }).all()) {
      await expect(each).toHaveAttribute("aria-expanded", "false");
      expect(await insideWindow(each, 375)).toBe(true);
    }
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  });

  test("Opening a row: a tap shows the details and actions under it, and another tap hides them", async ({
    page,
  }) => {
    const reader = unique("Accountant");
    const writer = unique("Conference laptop");
    await createKey(page.request, reader, "read-only", 30);
    await createKey(page.request, writer, "read-write", null);
    await page.goto("/credentials");
    const main = page.getByRole("main");
    const key = (name: string) =>
      main.getByRole("button", { name: `Details for key ${name}`, exact: true });
    await shown(key(reader));

    // A tap anywhere on the row opens it, not only on its chevron.
    await main.getByText(reader, { exact: true }).tap();
    await expect(key(reader)).toHaveAttribute("aria-expanded", "true");
    const readerDetails = await detailsOf(key(reader));
    await expect(readerDetails).toBeVisible();
    // The rows glide into place, so where they rest is measured once they stop.
    await settle(page);
    const readerRow = await boxOf(main.getByRole("listitem").filter({ hasText: reader }));
    expect((await boxOf(readerDetails)).y, "the details under their row").toBeGreaterThanOrEqual(
      readerRow.y + readerRow.height - 1,
    );
    // The details are a group named for their key, so a screen reader says whose they are.
    await expect(main.getByRole("group", { name: `Details for key ${reader}` })).toBeVisible();
    await expect(readerDetails.getByText("Read only", { exact: true })).toBeVisible();
    await expect(readerDetails.getByText("Expires", { exact: true })).toBeVisible();
    await expect(readerDetails.getByRole("button", { name: "Revoke" })).toBeVisible();

    // Several rows stay open at once, so two keys can be compared.
    await key(writer).tap();
    const writerDetails = await detailsOf(key(writer));
    await expect(writerDetails.getByText("Read and write", { exact: true })).toBeVisible();
    await expect(writerDetails.getByText("Never", { exact: true })).toBeVisible();
    await expect(key(reader)).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 320, height: 812 });
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });

    // Another tap closes the row and leaves the other open.
    await main.getByText(reader, { exact: true }).tap();
    await expect(key(reader)).toHaveAttribute("aria-expanded", "false");
    await expect(key(reader)).not.toHaveAttribute("aria-controls");
    await expect(readerDetails).toHaveCount(0);
    await expect(writerDetails).toBeVisible();

    // Revoke asks first. Once the key is revoked, its row leaves the list and focus moves to the
    // row of another key.
    await writerDetails.getByRole("button", { name: "Revoke" }).tap();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText(`Revoke “${writer}”?`);
    await confirm.getByRole("button", { name: "Revoke", exact: true }).tap();
    await expect(confirm).toHaveCount(0);
    await expect(key(writer)).toHaveCount(0);
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Details for key /);

    // A mount's row opens the same way, with its folder, and Rename and Remove.
    const first = unique("albums");
    const second = unique("backups");
    await createMount(page.request, first);
    await createMount(page.request, second);
    await page.goto("/storage");
    const mount = (path: string) =>
      main.getByRole("button", { name: `Details for mount ${path}`, exact: true });
    await main.getByText(`/${first}`, { exact: true }).tap();
    const albums = await detailsOf(mount(`/${first}`));
    await settle(page);
    await expect(albums.getByText("Whole backend", { exact: true })).toBeVisible();
    const form = page.getByRole("dialog");
    // Safari does not focus a button it taps, so Rename's dialog then returns focus to the
    // chevron. This runs first, while nothing else on the page is still watching where focus goes.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await albums.getByRole("button", { name: "Rename" }).dispatchEvent("click");
    await expect(form).toContainText(`Rename /${first}`);
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(mount(`/${first}`)).toBeFocused();
    // A browser that focuses the button it taps gets focus back on Rename.
    await albums.getByRole("button", { name: "Rename" }).tap();
    await expect(form).toContainText(`Rename /${first}`);
    await form.getByRole("button", { name: "Cancel" }).tap();
    await expect(form).toHaveCount(0);
    await expect(albums.getByRole("button", { name: "Rename" })).toBeFocused();
    // Removing the mount takes its row away, so focus moves to another mount's row.
    await albums.getByRole("button", { name: "Remove" }).tap();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove mount" }).tap();
    await expect(mount(`/${first}`)).toHaveCount(0);
    await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Details for mount /);

    // The chevron is a button, so a keyboard opens a row too.
    await mount(`/${second}`).focus();
    await page.keyboard.press("Enter");
    await expect(mount(`/${second}`)).toHaveAttribute("aria-expanded", "true");
  });

  test("Rows that glide: the rows under a row that opens or closes move to their places, at once with reduced motion", async ({
    page,
  }) => {
    // Keys list newest first, so the second key's row lies above the first's.
    const below = unique("Glide below");
    const above = unique("Glide above");
    await createKey(page.request, below);
    await createKey(page.request, above);
    for (const motion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto("/credentials");
      await shown(page.getByRole("main").getByRole("listitem").filter({ hasText: below }));
      // The first tap opens the row above, which moves the row under it down, and the second
      // closes it, which moves that row back up.
      for (const tap of ["opening", "closing"] as const) {
        const places = await page.evaluate(placesWhileToggling, {
          chevronLabel: `Details for key ${above}`,
          rowName: below,
        });
        const [first = 0] = places;
        const last = places.at(-1) ?? first;
        const moved = tap === "opening" ? last - first : first - last;
        expect(moved, `how far the row moved, ${tap}, ${motion}`).toBeGreaterThan(50);
        const top = Math.min(first, last);
        const bottom = Math.max(first, last);
        const between = places.filter((place) => place > top + 1 && place < bottom - 1);
        if (motion === "reduce") {
          expect(between, `the places between, ${tap} with reduced motion`).toEqual([]);
          // At once rather than late: the first frame after the tap shows the row at rest.
          const [, firstFrame = first] = places;
          expect(
            Math.abs(firstFrame - last),
            `the first frame after the tap, ${tap} with reduced motion`,
          ).toBeLessThanOrEqual(1);
        } else {
          expect(between.length, `the frames between its places, ${tap}`).toBeGreaterThan(0);
        }
      }
    }
  });

  test("Holding a row: its background is rounded and stays inside the card", async ({ page }) => {
    const name = unique("Held key");
    await createKey(page.request, name);
    await page.goto("/credentials");
    const row = page.getByRole("main").getByRole("listitem").filter({ hasText: name });
    await expect(row).toBeVisible();
    const box = await boxOf(row);
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + 40, y: box.y + box.height / 2 }],
    });
    // The pressed row draws its background, rounded, with the card's padding left around it.
    await expect.poll(() => row.evaluate(pressedBackground)).not.toBeNull();
    const pressed = await row.evaluate(pressedBackground);
    expect(pressed?.radius).toBeGreaterThan(0);
    expect(pressed?.inset).toBeGreaterThanOrEqual(8);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });

  test("Holding a chart: a finger shows a bar's values only while it holds the chart, above the chart", async ({
    page,
  }) => {
    // A second, empty backend, so the chart has a bar below the default backend's.
    await api(page.request, "POST", "/api/backends", {
      name: unique("Empty"),
      kind: "durable-object",
    });
    await page.goto("/");
    const chart = page.getByRole("img", { name: "Bytes stored on each backend" });
    await chart.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const values = page.getByRole("status", { name: /Stored: / });
    const { x, y, width } = await boxOf(chart);
    // A row 44 px tall per backend, largest first: the default backend holds the sample.
    const archive = { x: x + width / 2, y: y + 22 };
    const photos = { x: x + width / 2, y: y + 66 };
    const session = await page.context().newCDPSession(page);
    const finger = (type: "touchStart" | "touchMove" | "touchEnd", at?: { x: number; y: number }) =>
      session.send("Input.dispatchTouchEvent", { type, touchPoints: at === undefined ? [] : [at] });

    // A tap shows nothing, not for a single frame, even after the time a hold takes.
    let seen = await watchStoredValues(page);
    await finger("touchStart", archive);
    await finger("touchEnd");
    await page.waitForTimeout(1000);
    expect(await seen()).toBe(false);
    await expect(values).toBeHidden();

    // A held finger shows the bar under it, above the chart, where the finger does not cover it.
    await finger("touchStart", archive);
    await expect(values).toHaveAccessibleName(/^Default /);
    const shownAt = await boxOf(values);
    expect(shownAt.y + shownAt.height).toBeLessThanOrEqual(y);

    // Sliding the finger moves to the next bar, and the page stays where it was.
    const scrolled = await scrollOf(chart);
    for (const step of [1, 2, 3, 4]) {
      await finger("touchMove", {
        x: archive.x,
        y: archive.y + ((photos.y - archive.y) * step) / 4,
      });
      await nextFrame(page);
    }
    await expect(values).not.toHaveAccessibleName(/^Default /);
    expect(await scrollOf(chart)).toBe(scrolled);

    // Lifting the finger hides the values.
    await finger("touchEnd");
    await expect(values).toBeHidden();

    // A swipe that starts on the chart scrolls the page and shows nothing, not for a single frame.
    seen = await watchStoredValues(page);
    // By hand, since Chromium on Linux sends no touch moves for a synthesized scroll gesture.
    await finger("touchStart", archive);
    for (const step of [1, 2, 3, 4, 5, 6, 7, 8]) {
      await finger("touchMove", { x: archive.x, y: archive.y - step * 25 });
      await nextFrame(page);
    }
    await finger("touchEnd");
    await settle(page);
    expect(await scrollOf(chart)).toBeGreaterThan(scrolled + 100);
    expect(await seen()).toBe(false);
    await expect(values).toBeHidden();
  });
});

test("Closing a dialog: focus returns to the control that opened it", async ({ page }) => {
  const mount = unique("focus");
  await createMount(page.request, mount);
  const folder = filesAt(await scratchFolder(page.request));
  // A dialog opened from a menu returns focus to the menu's button, since the menu has closed.
  const cases = [
    { path: "/storage", opener: "Add mount", close: "Cancel" },
    { path: "/storage", opener: "Add mount", close: "Escape" },
    { path: "/storage", opener: "Add backend", close: "Cancel" },
    { path: "/storage", opener: `Actions for mount /${mount}`, item: "Rename", close: "Cancel" },
    { path: "/storage", opener: `Actions for mount /${mount}`, item: "Remove", close: "Cancel" },
    { path: "/credentials", opener: "Create key", close: "Cancel" },
    { path: "/credentials", opener: "Create key", close: "Escape" },
    { path: folder, opener: "New folder", close: "Cancel" },
    { path: folder, opener: "Actions for Contracts", item: "Rename", close: "Escape" },
  ];
  for (const { path, opener, item, close } of cases) {
    await page.goto(path);
    await page.getByRole("button", { name: opener, exact: true }).click();
    if (item !== undefined) {
      await page.getByRole("menuitem", { name: item }).click();
    }
    const dialog = page.getByRole(item === "Remove" ? "alertdialog" : "dialog");
    await expect(dialog).toBeVisible();
    await (close === "Escape"
      ? page.keyboard.press("Escape")
      : dialog.getByRole("button", { name: close }).click());

    await expect(dialog).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: opener, exact: true }),
      `${opener} ${item ?? ""} ${close}`,
    ).toBeFocused();
  }
});

test("A new name the search hides: focus moves to the search field", async ({ page }) => {
  await page.goto(filesAt(await scratchFolder(page.request)));
  const search = page.getByRole("searchbox", { name: "Search this folder" });
  await shown(page.getByRole("link", { name: "Contracts", exact: true }));
  await search.fill("con");
  await expect(page.getByRole("link", { name: "Drafts", exact: true })).toHaveCount(0);

  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Receipts");
  await page.getByRole("dialog").getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(search).toBeFocused();

  await page.getByRole("button", { name: "Actions for Contracts" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Leases");
  await page.getByRole("dialog").getByRole("button", { name: "Rename" }).click();
  await expect(page.getByRole("dialog")).toBeHidden();
  await expect(search).toBeFocused();
});

test("Clearing finished uploads: focus moves to the upload area's button", async ({ page }) => {
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  await shown(page.getByRole("link", { name: "Contracts", exact: true }));
  await page.getByRole("button", { name: "Upload" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Notes"),
  });
  await expect(onScreen(page, `Uploaded to ${folder}`)).toBeVisible();
  await page.getByRole("button", { name: "Clear finished" }).click();

  await expect(page.getByRole("button", { name: "Clear finished" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Upload files to ${folder}` })).toBeFocused();
});

test("Clearing a selection: focus moves to the checkbox of the first row that was selected", async ({
  page,
}) => {
  await page.goto(filesAt(await scratchFolder(page.request)));
  await page.getByRole("checkbox", { name: "Select Drafts" }).check();
  await page.getByRole("checkbox", { name: "Select Scans" }).check();
  await page.getByRole("button", { name: "Unselect All" }).click();

  await expect(page.getByRole("button", { name: "Unselect All" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Select Drafts" })).toBeFocused();
});

test("Deleting a row: focus moves to the row that took its place", async ({ page }) => {
  await page.goto(filesAt(await scratchFolder(page.request)));
  await expect(page.getByRole("row").nth(1)).toContainText("Contracts");
  await selectFirstRow(page);
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();

  await expect(page.getByRole("link", { name: "Drafts", exact: true })).toBeFocused();
});

for (const { width, where } of [
  { width: 1280, where: "beside the list" },
  { width: 1024, where: "in a dialog" },
]) {
  test(`Closing a file's details: focus returns to the file's row, ${where}`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(PREVIEW);
    await (
      width > 1024
        ? page.getByRole("button", { name: "Close details" })
        : page.getByRole("dialog").getByRole("button", { name: /^Close/ })
    ).click();

    await expect(page.getByRole("heading", { name: "Preview" })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "wifi-guest.txt" })).toBeFocused();
  });
}

test("Removing a mount: focus moves to the next mount's menu", async ({ page }) => {
  const first = unique("aaa-first");
  await createMount(page.request, first);
  await createMount(page.request, unique("aaa-second"));
  await page.goto("/storage");
  await page.getByRole("button", { name: `Actions for mount /${first}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove mount" }).click();

  await expect(page.getByRole("button", { name: `Actions for mount /${first}` })).toHaveCount(0);
  await expect(page.locator(":focus")).toHaveAttribute("aria-label", /^Actions for mount \//);
});

/** Whether a computed `rgb()` or `rgba()` color is a visible gray: its channels differ by 1 at most. */
const isGray = (color: string): boolean => {
  // Other notations put other numbers first, such as color(srgb 0.5 0 0.5).
  if (!/^rgba?\(/.test(color)) {
    return false;
  }
  const [red = -1, green = -2, blue = -3, alpha = 1] = (color.match(/[\d.]+/g) ?? []).map(Number);
  return alpha > 0 && Math.max(red, green, blue) - Math.min(red, green, blue) <= 1;
};

/** The color a theme token resolves to in the page's mode, as the browser reports it. */
const tokenColor = (page: Page, token: string): Promise<string> =>
  page.evaluate((name) => {
    const probe = document.createElement("span");
    probe.style.color = `var(${name})`;
    document.body.append(probe);
    const color = getComputedStyle(probe).color;
    probe.remove();
    return color;
  }, token);

const computed = (target: Locator, property: string): Promise<string> =>
  target.evaluate((node, name) => getComputedStyle(node).getPropertyValue(name), property);

test("Selected text and spelling marks: the selection is gray, misspellings take the error color and grammar the information color", async ({
  page,
}) => {
  await page.goto("/");
  await expect(levelOne(page)).toHaveText("Overview");

  // Without the page's own rules, the selection reads as transparent, which the browser paints
  // blue, and each mark reads as the browser's own line, which it paints red or green.
  const marks = await page.evaluate(() => ({
    selection: getComputedStyle(document.body, "::selection").backgroundColor,
    lines: ["::spelling-error", "::grammar-error"].map((pseudoElement) => {
      const style = getComputedStyle(document.body, pseudoElement);
      return {
        shape: `${style.textDecorationLine} ${style.textDecorationStyle}`,
        color: style.textDecorationColor,
      };
    }),
  }));
  expect(isGray(marks.selection), marks.selection).toBe(true);
  const [spelling, grammar] = marks.lines;
  expect(spelling?.shape).toBe("underline wavy");
  expect(spelling?.color).toBe(await tokenColor(page, "--color-text-error"));
  expect(grammar?.shape).toBe("underline wavy");
  expect(grammar?.color).toBe(await tokenColor(page, "--color-text-info"));
});

/** The WCAG 2 relative luminance of an opaque color in the rgb() notation a computed style uses. */
const luminanceOf = (color: string): number => {
  const [red = 0, green = 0, blue = 0] = (color.match(/[\d.]+/g) ?? []).slice(0, 3).map((part) => {
    const channel = Number(part) / 255;
    return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * red + 0.7152 * green + 0.0722 * blue;
};

/** The WCAG 2 contrast ratio of two such colors. */
const contrastOf = (one: string, other: string): number => {
  const [lighter = 0, darker = 0] = [luminanceOf(one), luminanceOf(other)].toSorted(
    (a, b) => b - a,
  );
  return (lighter + 0.05) / (darker + 0.05);
};

/** A text's color and the background it is drawn on, the nearest one an ancestor paints. */
const textOnBackground = (text: Locator) =>
  text.evaluate((node) => {
    let element: Element | null = node;
    while (element !== null && getComputedStyle(element).backgroundColor === "rgba(0, 0, 0, 0)") {
      element = element.parentElement;
    }
    return {
      color: getComputedStyle(node).color,
      background: element === null ? "" : getComputedStyle(element).backgroundColor,
    };
  });

test("Status colors: statuses and destructive actions take their status colors", async ({
  page,
}) => {
  await page.goto("/");
  const main = page.getByRole("main");
  // The icon beside a status's word, which carries the status's tone.
  const iconBeside = (label: string, tone: string) =>
    main
      .getByText(label, { exact: true })
      .first()
      .locator("xpath=..")
      .locator(`[data-color="${tone}"]`);

  await expect(iconBeside("Available", "success")).toHaveCount(1);
  expect(await computed(iconBeside("Available", "success"), "color")).toBe(
    await tokenColor(page, "--color-icon-success"),
  );
  await withUnavailableBackend(page);
  await page.reload();
  await expect(iconBeside("Unavailable", "error")).toHaveCount(1);
  expect(await computed(iconBeside("Unavailable", "error"), "color")).toBe(
    await tokenColor(page, "--color-icon-error"),
  );
  await page.unrouteAll();

  // Astryx fills a destructive button with the error color's muted shade, under its own text:
  // the Delete of a selection, the Delete in a file's details and a confirmation's action.
  const destructive = async (button: Locator) => {
    expect(await computed(button, "background-color")).toBe(
      await tokenColor(page, "--color-error-muted"),
    );
    expect(await computed(button, "color")).toBe(await tokenColor(page, "--color-on-error-muted"));
  };
  const folder = await scratchFolder(page.request);
  await page.goto(filesAt(folder));
  await selectFirstRow(page);
  await destructive(main.getByRole("button", { name: "Delete", exact: true }));
  await page.goto(PREVIEW);
  await shown(page.getByRole("heading", { name: "Preview" }));
  await destructive(main.getByRole("button", { name: "Delete", exact: true }));

  const mount = unique("colors");
  await createMount(page.request, mount);
  await page.goto("/storage");
  await page.getByRole("button", { name: `Actions for mount /${mount}` }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await destructive(page.getByRole("alertdialog").getByRole("button", { name: "Remove mount" }));

  // The error notification draws on Astryx's own red, whose text reaches 4.5:1 in either mode.
  // A delete the server refuses brings one up.
  await page.route("**/dav/**", (route) =>
    route.request().method() === "DELETE" ? route.fulfill({ status: 500 }) : route.continue(),
  );
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto(filesAt(folder));
    // The token resolves in the page's own mode, so the mode is checked before it is trusted.
    expect(await page.evaluate(bodyIsDark), colorScheme).toBe(colorScheme === "dark");
    await selectFirstRow(page);
    await page.getByRole("button", { name: "Delete", exact: true }).click();
    await page.getByRole("alertdialog").getByRole("button", { name: "Delete" }).click();
    const notice = onScreen(page, "The server refused the request (500).");
    await shown(notice);
    const { color, background } = await textOnBackground(notice);
    expect(background, colorScheme).toBe(
      await tokenColor(page, "--color-background-error-inverted"),
    );
    expect(contrastOf(color, background), colorScheme).toBeGreaterThanOrEqual(4.5);
  }
});

test("Rendered pages: the scan reports a red spelling mark and a checkbox left to the browser", async ({
  page,
}) => {
  await page.goto("/");
  await expect(levelOne(page)).toHaveText("Overview");

  const css = "h1::spelling-error { text-decoration-color: rgb(255 0 0); }";
  expect(await scanWith(page, { css })).not.toEqual([]);
  const html = "<input type='checkbox' checked style='accent-color: auto'>";
  expect(await scanWith(page, { html })).not.toEqual([]);
});

test("The name a screen reader hears: a file's link is named with the whole file name", async ({
  page,
}) => {
  await page.goto(filesAt("/files"));
  await expect(page.getByRole("link", { name: LONG_LOG_NAME, exact: true })).toBeVisible();
});

/**
 * The description Chromium gives each image in its accessibility tree, by the image's name. A
 * chart's description is an SVG `<desc>`, which Playwright's own description check does not read.
 */
const imageDescriptions = async (page: Page): Promise<Map<string, string>> => {
  const session = await page.context().newCDPSession(page);
  const { nodes } = await session.send("Accessibility.getFullAXTree");
  await session.detach();
  return new Map(
    nodes
      .filter((node) => node.role?.value === "image")
      .map((node) => [String(node.name?.value ?? ""), String(node.description?.value ?? "")]),
  );
};

test("The storage chart in words: it names the bytes on each backend", async ({ page }) => {
  await page.goto("/");
  await shown(page.getByRole("img", { name: "Bytes stored on each backend" }));
  // The default backend holds the sample, more than any backend the other tests add.
  expect((await imageDescriptions(page)).get("Bytes stored on each backend")).toMatch(
    /^Default stores [\d.]+ (bytes|kB|MB)(, .+ stores 0 bytes)*\.$/,
  );
});

// Runs in the page: where the labels of a chart start and end, sideways. The y axis's labels all end
// where the plot starts, so the one that starts furthest left is the longest of them; the one that
// ends furthest right is the x axis's last. A label's box is the box its words fill, not their ink.
const labelEdges = (chart: Element): { start: number; end: number } => {
  const boxes = [...chart.querySelectorAll("text")]
    .map((label) => label.getBoundingClientRect())
    .filter(({ width }) => width > 0);
  return {
    start: Math.min(...boxes.map((box) => box.left)),
    end: Math.max(...boxes.map((box) => box.right)),
  };
};

test("Charts on their card's grid: the longest label on the y axis starts where the title does", async ({
  page,
}) => {
  for (const width of [1280, 800, PHONE_WIDTH]) {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    for (const [title, name] of [["Storage by backend", "Bytes stored on each backend"]] as const) {
      const heading = page.getByRole("heading", { name: title, exact: true });
      const card = cardWith(page, heading);
      const { start } = await card.getByRole("img", { name }).evaluate(labelEdges);
      // Within 0.05 px: on a Mac, a label measured by its ink, as TanStack measures it, starts
      // 0.69 px out. Each edge is checked on its own, so one run reports every chart and width
      // that misses.
      expect
        .soft(start, `${title}'s longest label at ${width} px`)
        .toBeCloseTo((await boxOf(heading)).x, 1);
    }
  }
});

test("Focusing a chart: a click draws no ring, and the keyboard draws the theme's", async ({
  page,
}) => {
  await page.goto("/");
  const chart = page.getByRole("img", { name: "Bytes stored on each backend" });
  const ringOf = () =>
    chart.evaluate((element) => {
      const { outlineStyle, outlineColor } = getComputedStyle(element);
      // The theme's focus color, as this element would resolve it.
      const probe = document.createElement("span");
      probe.style.color = "var(--focus-outline-color)";
      element.parentElement?.append(probe);
      const theme = getComputedStyle(probe).color;
      probe.remove();
      return { style: outlineStyle, isTheme: outlineColor === theme };
    });

  // Chromium rings an SVG that a click focused, in the system's blue, unless the page stops it.
  await chart.click();
  await expect(chart).toBeFocused();
  expect((await ringOf()).style).toBe("none");

  // Tab from the control before it rings the chart as it rings every Astryx control.
  await page.getByRole("link", { name: "Manage storage" }).focus();
  await page.keyboard.press("Tab");
  await expect(chart).toBeFocused();
  const ring = await ringOf();
  expect(ring.style).not.toMatch(/^(none|auto)$/);
  expect(ring.isTheme).toBe(true);
});

test("Pointing at a chart: a mouse shows a bar's values over the chart and hides them when it leaves", async ({
  page,
}) => {
  await page.goto("/");
  const chart = page.getByRole("img", { name: "Bytes stored on each backend" });
  const values = page.getByRole("status", { name: /Stored: / });

  await chart.hover();
  await expect(values).toBeVisible();

  // TouchHold keeps a chart's mouseleave away from it only while a finger holds the chart.
  await page.mouse.move(0, 0);
  await expect(values).toBeHidden();
});

test("The address field's name: a screen reader hears the field's label alone", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "WebDAV address", exact: true })).toHaveValue(
    `${WORKERS_ORIGIN}/dav/`,
  );
});

test("The WebDAV section's address field: a screen reader hears its label alone", async ({
  page,
}) => {
  await page.goto("/settings?section=webdav");
  await expect(page.getByRole("textbox", { name: "Address", exact: true })).toHaveValue(
    `${WORKERS_ORIGIN}/dav/`,
  );
});

test("Opening the form again: the mount form starts from its own mount or the defaults", async ({
  page,
}) => {
  const first = unique("again-one");
  const second = unique("again-two");
  await createMount(page.request, first);
  await createMount(page.request, second);
  await page.goto("/storage");
  await page.getByRole("button", { name: `Actions for mount /${first}` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: `Actions for mount /${second}` }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await expect(page.getByRole("dialog").getByLabel("Folder name")).toHaveValue(second);
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add mount" }).click();
  await expect(page.getByRole("dialog").getByLabel("Folder name")).toHaveValue("");
});

test("Opening the name dialog again: New folder starts empty after a canceled rename", async ({
  page,
}) => {
  await page.goto(filesAt(await scratchFolder(page.request)));
  await page.getByRole("button", { name: "Actions for Contracts" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByRole("dialog").getByLabel("Name")).toHaveValue("");
});

test.describe("in a window 1100 px wide", () => {
  test.use({ viewport: { width: 1100, height: 800 } });

  test("A wider side navigation: Settings and Files lay out for the room it leaves them", async ({
    page,
  }) => {
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    const selector = page.getByRole("combobox", { name: "Section" });
    await page.goto("/settings");
    await expect(levelOne(page)).toHaveText("Settings");
    // Beside the navigation at its default width, the page has room for the section list.
    await expect(sections).toBeVisible();
    await expect(selector).toHaveCount(0);

    // Widened to 400 px, the navigation leaves the page 700 px: the list becomes a selector, Files
    // opens a file's details in a dialog, and neither page spills sideways.
    await dragNavigationEdge(page, 152);
    await expect(page.getByRole("separator", { name: "Resize sidebar" })).toHaveAttribute(
      "aria-valuenow",
      "400",
    );
    await expect(selector).toBeVisible();
    await expect(sections).toHaveCount(0);
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
    await page.goto(PREVIEW);
    await expect(page.getByRole("dialog").getByRole("heading", { name: "Preview" })).toBeVisible();
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);

    // Folded to its rail in a window 1000 px wide, the navigation leaves room for the list again.
    // The page slides with the rail as it folds, so it is measured once the motion has ended.
    await page.goto("/settings");
    await sideNavigation(page).getByRole("button", { name: "Collapse sidebar" }).click();
    await page.setViewportSize({ width: 1000, height: 800 });
    await expect(sections).toBeVisible();
    await page.evaluate(() =>
      Promise.all(
        document
          .getAnimations()
          .filter((animation) => animation.effect?.getComputedTiming().endTime !== Infinity)
          .map((animation) => animation.finished.catch(() => undefined)),
      ),
    );
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
    // Files has room again too, so a file's details sit in a panel beside the listing.
    await page.goto(PREVIEW);
    await expect(page.getByRole("heading", { name: "Preview" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Close details" })).toBeVisible();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  });

  test("Folding the navigation on Settings: the open section stays open in either layout", async ({
    page,
  }) => {
    // Beside the navigation at its default width, a window 1000 px wide leaves a narrow page.
    await page.setViewportSize({ width: 1000, height: 800 });
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    const selector = page.getByRole("combobox", { name: "Section" });
    await page.goto("/settings?section=webdav");
    await expect(selector).toBeVisible();
    await expect(selector).toHaveText("WebDAV");
    await sideNavigation(page).getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sections).toBeVisible();
    await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
    await sideNavigation(page).getByRole("button", { name: "Expand sidebar" }).click();
    await expect(selector).toBeVisible();
    await shown(page.getByRole("heading", { level: 2, name: "WebDAV" }));
  });
});
