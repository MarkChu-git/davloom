import { expect, test, type Locator, type Page } from "@playwright/test";

// The Dashboard prototype: its pages, how they are reached, and the colors they render.
const PAGES = [
  { path: "/", name: "Overview" },
  { path: "/files", name: "Files" },
  { path: "/credentials", name: "Credentials" },
  { path: "/storage", name: "Storage & Mounts" },
  { path: "/settings", name: "Settings" },
] as const;

const PREVIEW = "/files?path=%2Fshared&file=wifi-guest.txt";

const levelOne = (page: Page) => page.getByRole("heading", { level: 1 });
const sideNavigation = (page: Page) => page.getByRole("navigation", { name: "Side navigation" });
const shown = (locator: Locator) => expect(locator).toBeVisible();
/** Text on the screen, without the live regions that repeat it for screen readers. */
const onScreen = (page: Page, text: string | RegExp) =>
  page.getByText(text).and(page.locator(":not([data-astryx-live-region])"));

const selectFirstRow = (page: Page) => page.getByRole("row").nth(1).getByRole("checkbox").check();

/** Opens a Selector, in the dialog unless `scope` says where. One with a search field is a button. */
const openList = async (
  page: Page,
  role: "combobox" | "button",
  name: string | RegExp,
  scope: Page | Locator = page.getByRole("dialog"),
) => {
  await scope.getByRole(role, { name }).click();
  await shown(page.getByRole("option").first());
};

/** Makes the browser refuse to copy, as it does on a plain-HTTP origin. */
const blockClipboard = (page: Page) =>
  page.evaluate(() => {
    navigator.clipboard.writeText = () =>
      Promise.reject(new DOMException("Copying is blocked here.", "NotAllowedError"));
  });

const CLOCK_START = new Date("2026-11-16T12:00:00Z");

/** Gives the page a clock the test can stop. Installed alone, it keeps running. */
const installClock = (page: Page) => page.clock.install({ time: CLOCK_START });

/** Stops the page's timers, so a passing state stays while the scan reads it. */
const stopTimers = (page: Page) => page.clock.pauseAt(new Date(CLOCK_START.getTime() + 60_000));

/** The placeholder rows of a listing, by the component class Astryx documents for Skeleton. */
const placeholderRows = (page: Page) => page.locator(".astryx-skeleton");

interface PageState {
  name: string;
  path: string;
  /** A window width other than the default 1280 px. */
  width?: number;
  /** Runs before the page opens, for example to stop its timers so a passing state stays. */
  before?: (page: Page) => Promise<void>;
  show: (page: Page) => Promise<void>;
  /** Checks, after the scan, that the page still shows the passing state the scan read. */
  still?: (page: Page) => Promise<void>;
}

/**
 * The page states the scan covers: each page and Settings section, the dialogs, menus, option
 * lists and confirmations the pages open, the details dialog and the navigation menu of narrower
 * windows, and what components show only on focus, on hover, while they work or when they fail:
 * keyboard focus, a tooltip, notifications, warnings, field errors, a checked switch, empty
 * states, a loading listing, a busy button, upload progress and finished uploads, and row
 * selection.
 */
const STATES: readonly PageState[] = [
  { name: "Overview", path: "/", show: (page) => shown(page.getByText("Recent operation errors")) },
  {
    name: "Overview with a toast",
    path: "/",
    show: async (page) => {
      await page.getByRole("button", { name: "Check connections" }).click();
      await shown(onScreen(page, /still unreachable/));
    },
  },
  {
    name: "Overview with a busy button",
    path: "/",
    before: async (page) => {
      await installClock(page);
      await stopTimers(page);
    },
    show: async (page) => {
      await page.getByRole("button", { name: "Check connections" }).click();
      await expect(page.getByRole("button", { name: "Check connections" })).toHaveAttribute(
        "aria-busy",
        "true",
      );
    },
    still: (page) =>
      expect(page.getByRole("button", { name: "Check connections" })).toHaveAttribute(
        "aria-busy",
        "true",
      ),
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
      await shown(page.getByText("Recent operation errors"));
      await page.keyboard.press("Tab");
      await expect(page.locator(":focus-visible")).toHaveCount(1);
    },
  },
  {
    name: "Overview with a chart's tooltip",
    path: "/",
    show: async (page) => {
      await page.getByRole("img", { name: "Operations per hour, last 24 hours" }).hover();
      await shown(page.getByRole("status", { name: /Operations: \d/ }));
    },
  },
  {
    name: "the folded side navigation",
    path: "/",
    show: async (page) => {
      await sideNavigation(page).getByRole("button", { name: "Collapse sidebar" }).click();
      await shown(
        sideNavigation(page).getByRole("link", { name: "Storage & Mounts, 1 backend unreachable" }),
      );
    },
  },
  {
    name: "the top level of Files",
    path: "/files",
    show: (page) => shown(page.getByRole("link", { name: "documents", exact: true })),
  },
  {
    name: "a folder while it loads",
    path: "/files?path=%2Fdocuments",
    before: async (page) => {
      await installClock(page);
      await stopTimers(page);
    },
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
    name: "a backend that does not answer, with a tooltip",
    path: "/files?path=%2Farchive",
    show: async (page) => {
      await shown(onScreen(page, "Cannot list /archive"));
      await page.getByRole("button", { name: "New folder" }).hover();
      await shown(page.getByRole("tooltip"));
    },
  },
  {
    name: "a folder that does not exist",
    path: "/files?path=%2Fdocuments%2Fmissing",
    show: (page) => shown(page.getByRole("heading", { name: "This folder does not exist" })),
  },
  {
    name: "a search that matches nothing",
    path: "/files?path=%2Fdocuments",
    show: async (page) => {
      await page.getByRole("searchbox", { name: "Search this folder" }).fill("zzz");
      await shown(page.getByRole("heading", { name: "Nothing here matches “zzz”" }));
    },
  },
  {
    name: "selected rows",
    path: "/files?path=%2Fdocuments",
    show: async (page) => {
      await selectFirstRow(page);
      await shown(page.getByRole("button", { name: "Move" }));
    },
  },
  {
    name: "a row's menu",
    path: "/files?path=%2Fdocuments",
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
    path: "/files?path=%2Fdocuments",
    show: async (page) => {
      await page.getByRole("button", { name: "New folder" }).click();
      const name = page.getByRole("dialog").getByLabel("Name");
      await expect(name).toBeFocused();
      await name.pressSequentially("Rec");
    },
  },
  {
    name: "the Move dialog with its list open",
    path: "/files?path=%2Fdocuments",
    show: async (page) => {
      await selectFirstRow(page);
      await page.getByRole("button", { name: "Move" }).click();
      await openList(page, "button", /^Destination/);
    },
  },
  {
    name: "the Delete confirmation",
    path: "/files?path=%2Fdocuments",
    show: async (page) => {
      await selectFirstRow(page);
      await page.getByRole("button", { name: "Delete" }).click();
      await shown(page.getByRole("alertdialog"));
    },
  },
  {
    name: "an upload in progress",
    path: "/files?path=%2Fdocuments",
    before: installClock,
    show: async (page) => {
      // The listing arrives first, and then the timers stop, so the upload stays in progress.
      await shown(page.getByRole("row").nth(1));
      await stopTimers(page);
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
    path: "/files?path=%2Fdocuments",
    show: async (page) => {
      await page.getByRole("button", { name: "Upload" }).click();
      await page.locator('input[type="file"]').setInputFiles([
        { name: "notes.txt", mimeType: "text/plain", buffer: Buffer.from("Notes") },
        // A folder of this name is already here, so the upload is refused.
        { name: "Drafts", mimeType: "text/plain", buffer: Buffer.from("Drafts") },
      ]);
      await shown(onScreen(page, "Uploaded to /documents"));
      await shown(onScreen(page, /A folder named “Drafts” is already here/));
    },
  },
  {
    name: "Credentials",
    path: "/credentials",
    show: (page) => shown(page.getByText("Old tablet", { exact: true })),
  },
  {
    name: "a key's menu",
    path: "/credentials",
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
      await page.getByRole("button", { name: "Create key" }).click();
      await page.getByRole("dialog").getByRole("switch", { name: "Read only" }).check();
      await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
      await shown(onScreen(page, "Name the key after the device or person that will use it."));
    },
  },
  {
    name: "a new key, shown once",
    path: "/credentials",
    show: async (page) => {
      await page.getByRole("button", { name: "Create key" }).click();
      await page.getByRole("dialog").getByLabel("Name").fill("Work laptop");
      await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
      await shown(page.getByRole("heading", { name: "Key “Work laptop” is ready" }));
    },
  },
  {
    name: "the Create key dialog with its Mount list open",
    path: "/credentials",
    show: async (page) => {
      await page.getByRole("button", { name: "Create key" }).click();
      await openList(page, "combobox", "Mount");
    },
  },
  {
    name: "the Create key dialog with its Expires list open",
    path: "/credentials",
    show: async (page) => {
      await page.getByRole("button", { name: "Create key" }).click();
      await openList(page, "combobox", "Expires");
    },
  },
  {
    name: "the Revoke confirmation",
    path: "/credentials",
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
    show: (page) => shown(page.getByText("RustFS archive").first()),
  },
  {
    name: "a mount's menu",
    path: "/storage",
    show: async (page) => {
      await page.getByRole("button", { name: "Actions for mount /documents" }).click();
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
    name: "the Remove mount confirmation",
    path: "/storage",
    show: async (page) => {
      await page.getByRole("button", { name: "Actions for mount /photos" }).click();
      await page.getByRole("menuitem", { name: "Remove" }).click();
      await shown(page.getByRole("alertdialog"));
    },
  },
  {
    name: "Profile settings",
    path: "/settings?section=profile",
    show: (page) => shown(page.getByLabel("Display name")),
  },
  {
    name: "Sign-in and security settings",
    path: "/settings?section=security",
    show: (page) => shown(page.getByRole("button", { name: "Change password" })),
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
    name: "Storage settings",
    path: "/settings?section=storage",
    show: (page) => shown(page.getByRole("button", { name: "Save storage settings" })),
  },
  {
    name: "Storage settings with the backend list open",
    path: "/settings?section=storage",
    show: (page) => openList(page, "combobox", "Default backend for new mounts", page),
  },
  {
    name: "Data export with a notification",
    path: "/settings?section=export",
    show: async (page) => {
      await page.getByRole("button", { name: "Export" }).click();
      await shown(onScreen(page, /^Exported davloom-export/));
    },
  },
  {
    name: "About this instance",
    path: "/settings?section=about",
    show: (page) => shown(page.getByRole("heading", { name: "About this instance" })),
  },
  {
    name: "the navigation menu in a narrow window",
    path: "/",
    width: 375,
    show: async (page) => {
      await page.getByRole("button", { name: "Open navigation" }).click();
      await shown(
        page.getByRole("dialog", { name: "Navigation" }).getByRole("link", { name: "Files" }),
      );
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

// Runs in the page: every color that an element or one of its pseudo-elements paints with a hue.
// It reads colors inside shadows, filters, gradients and SVG data URLs too, including the color
// names an SVG uses. An RGB color is a gray when its channels differ by at most 1 in 255, the
// rounding that color mixing leaves; a Lab or LCH color when its chroma is as small. A notation it
// does not parse, such as XYZ, counts as a hue, and so does `accent-color: auto`, which leaves
// checkboxes and radio buttons to the browser's own blue.
const huesOnPage = (): string[] => {
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
          if (
            hasHue(
              notation,
              body.split(/[\s,/]+/).filter((part) => part !== ""),
            )
          ) {
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
    test(`Rendered pages: ${name} shows no hue in ${scheme} mode`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: scheme });
      if (width !== undefined) {
        await page.setViewportSize({ width, height: 900 });
      }
      await before?.(page);
      await page.goto(path);
      await show(page);

      expect(await page.evaluate(bodyIsDark)).toBe(scheme === "dark");
      expect(await page.evaluate(huesOnPage)).toEqual([]);
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
  const found = await page.evaluate(huesOnPage);
  await page.evaluate(() => {
    document.querySelector("#scan-sample-style")?.remove();
    document.querySelector("#scan-sample-html")?.remove();
  });
  return found;
};

const svgImage = (shapes: string) =>
  `h1 { background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg'%3E${shapes}%3C/svg%3E"); }`;

// Colors put on a page on purpose. The hues sit in places and notations that task 1.3 lists, one
// of them in a notation the scan does not parse, and the grays must pass.
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

test("Rendered pages: the scan reports hues put on a page on purpose, and no grays", async ({
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

test("Storage status in the navigation: an unreachable backend marks Storage & Mounts on every page", async ({
  page,
}) => {
  const navigation = sideNavigation(page);
  for (const { path, name } of PAGES) {
    await page.goto(path);
    await expect(levelOne(page)).toHaveText(name);
    // The glyph's label joins the link's name, after the visible label.
    await expect(
      navigation.getByRole("link", { name: /^Storage & Mounts\s*1 backend unreachable$/ }),
      path,
    ).toBeVisible();
    await expect(
      navigation.getByRole("img", { name: "1 backend unreachable", exact: true }),
      path,
    ).toBeVisible();
  }

  // The rail draws only icons, so the glyph takes the row's icon and the status joins its name.
  await navigation.getByRole("button", { name: "Collapse sidebar" }).click();
  const link = navigation.getByRole("link", { name: "Storage & Mounts, 1 backend unreachable" });
  await expect(link).toBeVisible();
  await expect(link.locator('[data-color="error"]')).toBeVisible();
  await link.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Storage & Mounts, 1 backend unreachable");
});

test("Resizing the side navigation: its edge drags wider and folds it to the rail past the minimum", async ({
  page,
}) => {
  await page.goto("/");
  const navigation = sideNavigation(page);
  const handle = page.getByRole("separator", { name: "Resize sidebar" });
  const width = async () => (await navigation.boundingBox())?.width ?? 0;
  await expect(handle).toHaveAttribute("aria-valuenow", "248");
  expect(await width()).toBe(248);

  // The edge also moves from the keyboard, as a separator does.
  await handle.focus();
  await page.keyboard.press("ArrowRight");
  const stepped = Number(await handle.getAttribute("aria-valuenow"));
  expect(stepped).toBeGreaterThan(248);

  const drag = async (by: number) => {
    const box = await handle.boundingBox();
    if (box === null) {
      throw new Error("The resize handle has no box.");
    }
    const y = box.y + box.height / 2;
    await page.mouse.move(box.x + box.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width / 2 + by, y, { steps: 8 });
    await page.mouse.up();
  };

  await drag(80);
  await expect(handle).toHaveAttribute("aria-valuenow", String(stepped + 80));
  expect(await width()).toBe(stepped + 80);

  // Narrower than the minimum, the navigation folds to its rail, and stays folded after a reload.
  await drag(-400);
  await expect(navigation.getByRole("button", { name: "Expand sidebar" })).toBeVisible();
  await expect(handle).toBeHidden();
  await page.reload();
  await expect(navigation.getByRole("button", { name: "Expand sidebar" })).toBeVisible();

  // Opening it again restores the width it had.
  await navigation.getByRole("button", { name: "Expand sidebar" }).click();
  await expect(handle).toHaveAttribute("aria-valuenow", String(stepped + 80));
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

test("Figures at two widths: the three headline figures sit side by side at 900 px and one above another at 800 px", async ({
  page,
}) => {
  const main = page.getByRole("main");
  const figures = async () =>
    Promise.all(
      ["Stored", "Known capacity", "Mounts"].map(async (label) => {
        const box = await main.getByText(label, { exact: true }).boundingBox();
        if (box === null) {
          throw new Error(`The ${label} figure has no box.`);
        }
        return box;
      }),
    );

  await page.setViewportSize({ width: 900, height: 900 });
  await page.goto("/");
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

// Runs in the page: the main landmark and each element around it, up to the root, that is wider
// inside than it is, so it scrolls or cuts its content off sideways. The page scrolls inside the
// layout's main landmark rather than the document, so the document's own width alone misses it.
// Astryx renders the landmark as an element with role="main", not as <main>.
const sidewaysOverflow = (): string[] => {
  const main = document.querySelector('[role="main"]');
  if (main === null) {
    return ["no main landmark"];
  }
  const found: string[] = [];
  for (let element: Element | null = main; element !== null; element = element.parentElement) {
    if (element.scrollWidth > element.clientWidth) {
      found.push(`${element.tagName}: ${element.scrollWidth} > ${element.clientWidth}`);
    }
  }
  return found;
};

test.describe("in a window 375 px wide", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Narrow screens: the navigation sits behind a menu button and no page scrolls sideways", async ({
    page,
  }) => {
    for (const { path, name } of [...PAGES, { path: PREVIEW, name: "Files" }]) {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText(name);
      // Files lists a folder after a short pause, and the list is what could spill sideways.
      if (path.startsWith("/files")) {
        await shown(page.getByRole("row").nth(1));
      }

      await expect(page.getByRole("button", { name: "Open navigation" })).toBeVisible();
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
    expect(box !== null && box.x >= 0 && box.x + box.width <= 375).toBe(true);
    expect(await dialog.evaluate((element) => element.scrollWidth <= element.clientWidth)).toBe(
      true,
    );
  });
});

test("Closing a dialog: focus returns to the control that opened it", async ({ page }) => {
  // A dialog opened from a menu returns focus to the menu's button, since the menu has closed.
  const cases = [
    { path: "/storage", opener: "Add mount", close: "Cancel" },
    { path: "/storage", opener: "Add mount", close: "Escape" },
    { path: "/storage", opener: "Actions for mount /photos", item: "Edit", close: "Cancel" },
    { path: "/storage", opener: "Actions for mount /photos", item: "Remove", close: "Cancel" },
    { path: "/credentials", opener: "Create key", close: "Cancel" },
    { path: "/credentials", opener: "Create key", close: "Escape" },
    { path: "/files?path=%2Fdocuments", opener: "New folder", close: "Cancel" },
    {
      path: "/files?path=%2Fdocuments",
      opener: "Actions for Contracts",
      item: "Rename",
      close: "Escape",
    },
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
  await page.goto("/files?path=%2Fdocuments");
  const search = page.getByRole("searchbox", { name: "Search this folder" });
  await search.fill("con");
  await shown(page.getByRole("link", { name: "Contracts", exact: true }));

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
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "Upload" }).click();
  await page.locator('input[type="file"]').setInputFiles({
    name: "notes.txt",
    mimeType: "text/plain",
    buffer: Buffer.from("Notes"),
  });
  await expect(onScreen(page, "Uploaded to /documents")).toBeVisible();
  await page.getByRole("button", { name: "Clear finished" }).click();

  await expect(page.getByRole("button", { name: "Clear finished" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Upload files to /documents" })).toBeFocused();
});

test("Clearing a selection: focus moves to the checkbox of the first row that was selected", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("checkbox", { name: "Select Drafts" }).check();
  await page.getByRole("checkbox", { name: "Select Scans" }).check();
  await page.getByRole("button", { name: "Unselect All" }).click();

  await expect(page.getByRole("button", { name: "Unselect All" })).toHaveCount(0);
  await expect(page.getByRole("checkbox", { name: "Select Drafts" })).toBeFocused();
});

test("Deleting a row: focus moves to the row that took its place", async ({ page }) => {
  await page.goto("/files?path=%2Fdocuments");
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
  await page.goto("/storage");
  await page.getByRole("button", { name: "Actions for mount /documents" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await page.getByRole("alertdialog").getByRole("button", { name: "Remove mount" }).click();

  await expect(page.getByRole("button", { name: "Actions for mount /shared" })).toBeFocused();
});

test("Signing out a session: focus moves to Set up, the control above the sessions", async ({
  page,
}) => {
  await page.goto("/settings?section=security");
  await page.getByRole("button", { name: "Sign out Firefox on Windows" }).click();

  await expect(page.getByRole("button", { name: "Sign out Firefox on Windows" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Set up" })).toBeFocused();
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

test("Selected text and spelling marks: the page paints them gray", async ({ page }) => {
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
  for (const line of marks.lines) {
    expect(line.shape).toBe("underline wavy");
    expect(isGray(line.color), line.color).toBe(true);
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
  await page.goto("/files?path=%2Fdocuments");

  const name =
    "an-export-from-the-old-nas-with-a-very-long-file-name-that-keeps-going-2026-11-16.log";
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
});

test("Opening the form again: the mount form starts from its own mount or the defaults", async ({
  page,
}) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Actions for mount /photos" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Actions for mount /documents" }).click();
  await page.getByRole("menuitem", { name: "Edit" }).click();
  await expect(page.getByRole("dialog").getByLabel("Folder name")).toHaveValue("documents");
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "Add mount" }).click();
  await expect(page.getByRole("dialog").getByLabel("Folder name")).toHaveValue("");
});

test("Opening the name dialog again: New folder starts empty after a canceled rename", async ({
  page,
}) => {
  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "Actions for Contracts" }).click();
  await page.getByRole("menuitem", { name: "Rename" }).click();
  await page.getByRole("dialog").getByRole("button", { name: "Cancel" }).click();
  await page.getByRole("button", { name: "New folder" }).click();
  await expect(page.getByRole("dialog").getByLabel("Name")).toHaveValue("");
});

test("A folder outside the mount: the form refuses a scope with ..", async ({ page }) => {
  await page.goto("/credentials");
  await page.getByRole("button", { name: "Create key" }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Name").fill("Escape attempt");
  await dialog.getByRole("combobox", { name: "Mount" }).click();
  await page.getByRole("option", { name: "/documents" }).click();
  await dialog.getByLabel("Folder inside the mount").fill("../photos");
  await dialog.getByRole("button", { name: "Create key" }).click();

  await expect(onScreen(page, /without \. or \.\. in its path/)).toBeVisible();
  await expect(page.getByRole("heading", { name: "Key “Escape attempt” is ready" })).toHaveCount(0);
});

test("A profile without a name: saving refuses it and an address without an @", async ({
  page,
}) => {
  await page.goto("/settings?section=profile");
  await page.getByLabel("Display name").fill("");
  await page.getByLabel("Email").fill("home-admin");
  await page.getByRole("button", { name: "Save profile" }).click();

  await expect(onScreen(page, "Enter the name Davloom should call you.")).toBeVisible();
  await expect(onScreen(page, /^Enter an email address/)).toBeVisible();
  await expect(onScreen(page, "Profile saved.")).toHaveCount(0);
});

test("No requests to the API: browsing and changing sample data stays in the browser", async ({
  page,
}) => {
  const paths: string[] = [];
  page.on("request", (request) => paths.push(new URL(request.url()).pathname));

  for (const { path, name } of PAGES) {
    await page.goto(path);
    await expect(levelOne(page)).toHaveText(name);
  }

  await page.goto("/credentials");
  await page.getByRole("button", { name: "Create key" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Test key");
  await page.getByRole("dialog").getByRole("button", { name: "Create key" }).click();
  await page.getByRole("button", { name: "Done" }).click();
  await expect(page.getByRole("table").getByText("Test key", { exact: true })).toBeVisible();

  await page.goto("/storage");
  await page.getByRole("button", { name: "Add mount" }).click();
  // Typed with the slash and spaces a user might add, which the folder name drops.
  await page.getByRole("dialog").getByLabel("Folder name").fill(" / music ");
  await page.getByRole("dialog").getByRole("button", { name: "Add mount" }).click();
  await expect(page.getByRole("cell", { name: "/music", exact: true })).toBeVisible();

  await page.goto("/files?path=%2Fdocuments");
  await page.getByRole("button", { name: "New folder" }).click();
  await page.getByRole("dialog").getByLabel("Name").fill("Receipts");
  await page.getByRole("dialog").getByRole("button", { name: "Create folder" }).click();
  await expect(page.getByRole("link", { name: "Receipts" })).toBeVisible();

  expect(paths.filter((path) => path.startsWith("/api/") || path.startsWith("/dav/"))).toEqual([]);
});

test("Changes last for the visit: a new mount shows in Files until a reload", async ({ page }) => {
  await page.goto("/storage");
  await page.getByRole("button", { name: "Add mount" }).click();
  await page.getByRole("dialog").getByLabel("Folder name").fill("music");
  await page.getByRole("dialog").getByRole("button", { name: "Add mount" }).click();

  await sideNavigation(page).getByRole("link", { name: "Files" }).click();
  await expect(page.getByRole("link", { name: "music", exact: true })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("link", { name: "documents", exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "music", exact: true })).toHaveCount(0);
});
