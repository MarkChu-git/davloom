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
/**
 * Text on the screen, without the live regions that repeat it for screen readers: the page's own,
 * and the one a dialog keeps for its alerts.
 */
const onScreen = (page: Page, text: string | RegExp) =>
  page
    .getByText(text)
    .and(page.locator(":not([data-astryx-live-region], [data-astryx-modal-live-region])"));

const selectFirstRow = (page: Page) => page.getByRole("row").nth(1).getByRole("checkbox").check();

/** The Overview's card of recent operation errors. */
const errorsPanel = (page: Page) =>
  page
    .getByRole("main")
    .locator(".astryx-card")
    .filter({ has: page.getByRole("heading", { name: "Recent operation errors" }) });

/** The timeline view of the recent operation errors. */
const errorTimeline = (page: Page) =>
  page.getByRole("img", { name: "Operation errors, last 24 hours" });

/** The timeline's markers, 20 px in radius; the ring around a marker in focus is larger. */
const errorMarkers = (page: Page) => errorTimeline(page).locator('circle[r="20"]');

/** The center and radius of each marker on the timeline, in the order of the sample errors. */
const markerCenters = async (page: Page) =>
  Promise.all(
    (await errorMarkers(page).all()).map(async (marker) => {
      const { x, y, width } = await marker.evaluate((node) =>
        node.getBoundingClientRect().toJSON(),
      );
      return { x: x + width / 2, y: y + width / 2, radius: width / 2 };
    }),
  );

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
    still: (page) => shown(page.getByRole("status", { name: /Operations: \d/ })),
  },
  {
    name: "Overview with a chart in keyboard focus",
    path: "/",
    show: async (page) => {
      const chart = page.getByRole("img", { name: "Operations per hour, last 24 hours" });
      await shown(chart);
      // Tabs through the page, as a keyboard user reaches the chart.
      for (let step = 0; step < 30; step += 1) {
        if (await chart.evaluate((node) => node === document.activeElement)) {
          break;
        }
        await page.keyboard.press("Tab");
      }
      await expect(chart).toBeFocused();
      await expect(page.locator(":focus-visible")).toHaveCount(1);
    },
    still: (page) =>
      expect(page.getByRole("img", { name: "Operations per hour, last 24 hours" })).toBeFocused(),
  },
  {
    name: "Overview with an error open in the list, in a narrow window",
    path: "/",
    width: 375,
    show: async (page) => {
      await page.getByRole("button", { name: "Details for 2026-11-16.tar.zst" }).click();
      await shown(page.getByRole("group", { name: "Details for 2026-11-16.tar.zst" }));
    },
  },
  {
    name: "Overview with an error's details on the timeline",
    path: "/",
    show: async (page) => {
      await page.getByRole("radio", { name: "Timeline" }).click();
      await errorMarkers(page).first().hover();
      await shown(page.getByRole("status", { name: /^2026-11-16\.tar\.zst/ }));
    },
    still: (page) => shown(page.getByRole("status", { name: /^2026-11-16\.tar\.zst/ })),
  },
  {
    name: "Overview with an error's tile open",
    path: "/",
    show: async (page) => {
      await page.getByRole("radio", { name: "Tiles" }).click();
      // The tile's face lies over its button and takes the click, as it takes a tap.
      await page.getByRole("button", { name: /^Drafts, / }).click({ force: true });
      await shown(page.getByRole("dialog", { name: "Drafts" }));
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
    name: "Credentials as a list in a narrow window, with two keys open",
    path: "/credentials",
    width: 375,
    show: async (page) => {
      for (const name of ["Old tablet", "Conference laptop"]) {
        await page.getByRole("button", { name: `Details for key ${name}` }).click();
      }
      await shown(page.getByRole("main").getByRole("button", { name: "Revoke" }));
    },
  },
  {
    name: "Storage & Mounts in the narrowest window, with a mount open",
    path: "/storage",
    width: 320,
    show: async (page) => {
      await page.getByRole("button", { name: "Details for mount /documents" }).click();
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
      await page.goto(path);
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
  await expect(
    driveIcon(navigation.getByRole("link", { name: /^Storage & Mounts\s*1 backend unreachable$/ })),
  ).toHaveCount(1);
  await navigation.getByRole("button", { name: "Collapse sidebar" }).click();
  const link = navigation.getByRole("link", { name: "Storage & Mounts, 1 backend unreachable" });
  await expect(link).toBeVisible();
  await expect(link.locator('[data-color="error"]')).toBeVisible();
  await expect(driveIcon(link)).toHaveCount(0);
  await link.hover();
  await expect(page.getByRole("tooltip")).toHaveText("Storage & Mounts, 1 backend unreachable");
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

// Runs in the page: what scrolls or reaches past the window sideways. That is the main landmark
// and each element around it, up to the root, when it is wider inside than it is; each element in
// it that scrolls sideways, as a page does inside its layout and a table inside its frame; and each
// element whose visible part, after whatever clips it, reaches past an edge of the window. Text cut
// off with an ellipsis is cut off on purpose, so it does not count. Astryx renders the landmark as
// an element with role="main", not as <main>.
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
  const windowWidth = document.documentElement.clientWidth;
  for (const element of main.querySelectorAll("*")) {
    const style = getComputedStyle(element);
    // Labels kept for screen readers alone sit in a box 1 px wide that cuts them off on purpose.
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      element.getBoundingClientRect().width <= 1
    ) {
      continue;
    }
    const name = `${element.tagName.toLowerCase()} "${(element.textContent ?? "").trim().slice(0, 30)}"`;
    const truncates = style.textOverflow === "ellipsis" || style.webkitLineClamp !== "none";
    if (
      style.overflowX !== "visible" &&
      !truncates &&
      element.scrollWidth > element.clientWidth + 1
    ) {
      found.push(`scrolls ${element.scrollWidth} > ${element.clientWidth}: ${name}`);
    }
    // The part of the element that what clips it leaves in sight.
    let { left: start, right: end } = element.getBoundingClientRect();
    for (let clip = element.parentElement; clip !== null; clip = clip.parentElement) {
      if (getComputedStyle(clip).overflowX !== "visible") {
        const box = clip.getBoundingClientRect();
        start = Math.max(start, box.left);
        end = Math.min(end, box.right);
      }
    }
    if (end - start > 1 && (start < -0.5 || end > windowWidth + 0.5)) {
      found.push(`reaches ${Math.round(start)} to ${Math.round(end)}: ${name}`);
    }
  }
  return found;
};

/** The box of an element that must be on screen. */
const boxOf = async (target: Locator) => {
  const box = await target.boundingBox();
  if (box === null) {
    throw new Error("The element has no box.");
  }
  return box;
};

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
 * Runs in the page: where the row of "Conference laptop" is on each frame, from before a tap on
 * the chevron of "Old tablet" above it, which opens or closes that row, until a second later.
 */
const placesWhileToggling = async (): Promise<number[]> => {
  const main = document.querySelector('[role="main"]');
  const chevron = [...(main?.querySelectorAll("button") ?? [])].find(
    (button) => button.getAttribute("aria-label") === "Details for key Old tablet",
  );
  const row = [...(main?.querySelectorAll("li") ?? [])].find((item) =>
    (item.textContent ?? "").startsWith("Conference laptop"),
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

// WCAG 1.4.10 asks content to reflow to 320 px without scrolling sideways, narrower than any
// common phone.
const PHONE_WIDTH = 320;

test.describe(`in a window ${PHONE_WIDTH} px wide`, () => {
  test.use({ viewport: { width: PHONE_WIDTH, height: 780 } });

  test("Narrow screens: the navigation sits behind a Menu button and no page scrolls sideways", async ({
    page,
  }) => {
    for (const { path, name } of [
      ...PAGES,
      { path: "/files?path=%2Fdocuments", name: "Files" },
      ...["security", "webdav", "storage"].map((section) => ({
        path: `/settings?section=${section}`,
        name: "Settings",
      })),
      { path: PREVIEW, name: "Files" },
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

    // The default backend's mark leads the line of the mounts it serves, so the window cuts the
    // paths short rather than the mark.
    await page.goto("/");
    const mark = page.getByRole("main").getByText("Default · /documents, /shared", { exact: true });
    await expect(mark).toBeVisible();
    expect(
      await mark.evaluate((element) => {
        const text = element.firstChild;
        if (text === null) {
          return false;
        }
        const word = document.createRange();
        word.setStart(text, 0);
        word.setEnd(text, "Default".length);
        // An ellipsis takes about a letter's width at the end of the line.
        const fontSize = Number.parseFloat(getComputedStyle(element).fontSize);
        return (
          word.getBoundingClientRect().right <= element.getBoundingClientRect().right - fontSize
        );
      }),
      "the default backend's mark, whole",
    ).toBe(true);
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
    await expect(
      dropdown.getByRole("link", { name: /^Storage & Mounts\s*1 backend unreachable$/ }),
    ).toBeVisible();
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
    for (const { path, name } of [...PAGES, { path: "/files?path=%2Fdocuments", name: "Files" }]) {
      await page.goto(path);
      await expect(levelOne(page)).toHaveText(name);
      if (path.startsWith("/files")) {
        await shown(page.getByRole("row").nth(1));
      }
      expect(await page.evaluate(sidewaysOverflow), path).toEqual([]);
    }

    // Credentials lists each key as a row here, and gives each detail a column where there is room.
    await page.goto("/credentials");
    const chevrons = page.getByRole("main").getByRole("button", { name: /^Details for key / });
    await expect(chevrons).toHaveCount(5);
    for (const chevron of await chevrons.all()) {
      await expect(chevron).toBeInViewport({ ratio: 1 });
    }
    await chevrons.first().hover();
    await expect(page.getByRole("tooltip")).toHaveText("Details for key Laptop (Finder)");
    await expect(page.getByRole("table")).toHaveCount(0);
    await page.setViewportSize({ width: 1280, height: 768 });
    await expect(page.getByRole("columnheader", { name: "Scope" })).toBeVisible();
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  });
});

test.describe("in a window 375 px wide", () => {
  test.use({ viewport: { width: 375, height: 812 } });

  test("Sorting a narrow listing: a menu in the Name header's place sorts by name, size or time, either way", async ({
    page,
  }) => {
    await page.goto("/files?path=%2Fdocuments");
    const main = page.getByRole("main");
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
    const FOLDERS = ["Contracts", "Drafts", "Invoices 2026", "Scans"];
    const EXPORT =
      "an-export-from-the-old-nas-with-a-very-long-file-name-that-keeps-going-2026-11-16.log";
    const REPORT = "Quarterly report — Q3 2026, final version (signed by both parties).pdf";
    const BY_NAME = [
      EXPORT,
      "budget-2027.xlsx",
      "meeting-notes-2026-11-14.md",
      REPORT,
      "README.txt",
    ];
    const BY_SIZE = [
      "README.txt",
      "meeting-notes-2026-11-14.md",
      "budget-2027.xlsx",
      EXPORT,
      REPORT,
    ];
    const BY_TIME = [
      "README.txt",
      REPORT,
      "meeting-notes-2026-11-14.md",
      "budget-2027.xlsx",
      EXPORT,
    ];
    const FOLDERS_BY_TIME = ["Scans", "Contracts", "Invoices 2026", "Drafts"];
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
    await sortBy("Size, smallest first", "Modified", "Modified, oldest first");
    expect(await order()).toEqual([...FOLDERS_BY_TIME, ...BY_TIME]);
    await sortBy("Modified, oldest first", "Newest first", "Modified, newest first");
    const NEWEST_FIRST = [...FOLDERS_BY_TIME.toReversed(), ...BY_TIME.toReversed()];
    expect(await order()).toEqual(NEWEST_FIRST);

    // A wider window brings the columns back in the same order, which the Modified header shows.
    await page.setViewportSize({ width: 1280, height: 812 });
    await expect(main.getByRole("columnheader", { name: /Modified/ })).toHaveAttribute(
      "aria-sort",
      "descending",
    );
    expect(await order()).toEqual(NEWEST_FIRST);
  });
});

test.describe("on a touch screen", () => {
  test.use({ viewport: { width: 375, height: 812 }, hasTouch: true, isMobile: true });

  test("Lists on a phone: each key and each mount is a row with its name and one line under it", async ({
    page,
  }) => {
    await page.goto("/credentials");
    const main = page.getByRole("main");
    const keys = main.getByRole("listitem");
    // Once the keys are drawn as rows, no table is drawn beside them.
    await expect(keys).toHaveCount(5);
    await expect(page.getByRole("table")).toHaveCount(0);
    // A row shows a key's name, first characters and status, and the rest waits until it opens.
    expect(await keys.evaluateAll(linesOf)).toEqual([
      ["Laptop (Finder)", "dvl_7Q2M…", "Active"],
      ["Phone photo backup", "dvl_K9XA…", "Active"],
      ["Accountant, invoices only", "dvl_P3VD…", "Active"],
      ["Old tablet", "dvl_2HTE…", "Revoked"],
      ["Conference laptop", "dvl_M4RC…", "Expired"],
    ]);
    for (const key of await keys.all()) {
      const toggle = key.getByRole("button", { name: /^Details for key / });
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(await insideWindow(toggle, 375)).toBe(true);
    }
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);

    // Each name has a line of its own, so even the narrowest phone shows it whole in the larger
    // type of a touch screen. Under it, a key's first characters share a line with its status, and
    // the statuses end in one column.
    const KEYS = [
      ["Laptop (Finder)", "Active"],
      ["Phone photo backup", "Active"],
      ["Accountant, invoices only", "Active"],
      ["Old tablet", "Revoked"],
      ["Conference laptop", "Expired"],
    ] as const;
    for (const width of [375, 320]) {
      await page.setViewportSize({ width, height: 812 });
      const ends = new Set<number>();
      for (const [name, state] of KEYS) {
        const key = keys.filter({ hasText: name });
        const where = `${name} at ${width} px`;
        const title = key.getByText(name, { exact: true });
        expect(
          await title.evaluate((element) => element.scrollWidth <= element.clientWidth),
          where,
        ).toBe(true);
        const titleBox = await boxOf(title);
        const prefix = await boxOf(key.getByText(/^dvl_\w{4}…$/));
        const status = await boxOf(key.getByText(state, { exact: true }));
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
    const toggles = main.getByRole("button", { name: /^Details for mount / });
    await expect(toggles).toHaveCount(4);
    await expect(page.getByRole("table")).toHaveCount(0);
    // A mount's row shows its path and backend, and the rest waits until it opens.
    expect(await main.getByRole("listitem").evaluateAll(linesOf)).toEqual([
      ["/documents", "Durable Objects"],
      ["/shared", "Durable Objects"],
      ["/photos", "R2 photos"],
      ["/archive", "RustFS archive"],
    ]);
    for (const toggle of await toggles.all()) {
      await expect(toggle).toHaveAttribute("aria-expanded", "false");
      expect(await insideWindow(toggle, 375)).toBe(true);
    }
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
  });

  test("Opening a row: a tap shows the details and actions under it, and another tap hides them", async ({
    page,
  }) => {
    await page.goto("/credentials");
    const main = page.getByRole("main");
    const key = (name: string) =>
      main.getByRole("button", { name: `Details for key ${name}`, exact: true });
    await expect(main.getByRole("listitem")).toHaveCount(5);

    // A tap anywhere on the row opens it, not only on its chevron.
    await main.getByText("Old tablet", { exact: true }).tap();
    await expect(key("Old tablet")).toHaveAttribute("aria-expanded", "true");
    const tablet = await detailsOf(key("Old tablet"));
    await expect(tablet).toBeVisible();
    // The rows glide into place, so where they rest is measured once they stop.
    await settle(page);
    const tabletRow = await boxOf(main.getByRole("listitem").filter({ hasText: "Old tablet" }));
    expect((await boxOf(tablet)).y, "the details under their row").toBeGreaterThanOrEqual(
      tabletRow.y + tabletRow.height - 1,
    );
    // The details are a group named for their key, so a screen reader says whose they are.
    await expect(main.getByRole("group", { name: "Details for key Old tablet" })).toBeVisible();
    for (const words of ["Read only", "All mounts", "2 months ago"]) {
      await expect(tablet.getByText(words, { exact: true })).toBeVisible();
    }
    // Past its expiry time a key says it expired, revoked or not. A revoked key has no action.
    await expect(tablet.getByText("Expired", { exact: true })).toBeVisible();
    await expect(tablet.getByText("Sep 30, 2026", { exact: true })).toBeVisible();
    await expect(tablet.getByRole("button")).toHaveCount(0);

    // Several rows stay open at once, so two keys can be compared.
    await key("Conference laptop").tap();
    const conference = await detailsOf(key("Conference laptop"));
    await expect(conference.getByText("Expired", { exact: true })).toBeVisible();
    await expect(conference.getByText("Oct 31, 2026", { exact: true })).toBeVisible();
    await expect(key("Old tablet")).toHaveAttribute("aria-expanded", "true");
    await page.setViewportSize({ width: 320, height: 812 });
    expect(await page.evaluate(sidewaysOverflow)).toEqual([]);
    await page.setViewportSize({ width: 375, height: 812 });

    // Another tap closes the row and leaves the other open.
    await main.getByText("Old tablet", { exact: true }).tap();
    await expect(key("Old tablet")).toHaveAttribute("aria-expanded", "false");
    await expect(key("Old tablet")).not.toHaveAttribute("aria-controls");
    await expect(tablet).toHaveCount(0);
    await expect(conference).toBeVisible();

    // Revoke asks first. Once the key is revoked, its details keep no action and focus moves to
    // its row.
    await conference.getByRole("button", { name: "Revoke" }).tap();
    const confirm = page.getByRole("alertdialog");
    await expect(confirm).toContainText("Revoke “Conference laptop”?");
    await confirm.getByRole("button", { name: "Revoke", exact: true }).tap();
    await expect(confirm).toHaveCount(0);
    await expect(main.getByRole("listitem").filter({ hasText: "Conference laptop" })).toContainText(
      "Revoked",
    );
    await expect(conference.getByRole("button")).toHaveCount(0);
    await expect(key("Conference laptop")).toBeFocused();

    // A mount's row opens the same way, with its bucket, its prefix, and Edit and Remove.
    await page.goto("/storage");
    const mount = (path: string) =>
      main.getByRole("button", { name: `Details for mount ${path}`, exact: true });
    await main.getByText("/photos", { exact: true }).tap();
    const photos = await detailsOf(mount("/photos"));
    await settle(page);
    const bucket = await boxOf(photos.getByText("davloom-photos", { exact: true }));
    const prefix = await boxOf(photos.getByText("None", { exact: true }));
    expect(prefix.y, "the prefix on a line under the bucket").toBeGreaterThanOrEqual(
      bucket.y + bucket.height - 1,
    );
    const form = page.getByRole("dialog");
    // Safari does not focus a button it taps, so Edit's dialog then returns focus to the chevron.
    // This runs first, while nothing else on the page is still watching where focus goes.
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
    });
    await photos.getByRole("button", { name: "Edit" }).dispatchEvent("click");
    await expect(form).toContainText("Edit /photos");
    await page.keyboard.press("Escape");
    await expect(form).toHaveCount(0);
    await expect(mount("/photos")).toBeFocused();
    // A browser that focuses the button it taps gets focus back on Edit.
    await photos.getByRole("button", { name: "Edit" }).tap();
    await expect(form).toContainText("Edit /photos");
    await form.getByRole("button", { name: "Cancel" }).tap();
    await expect(form).toHaveCount(0);
    await expect(photos.getByRole("button", { name: "Edit" })).toBeFocused();
    // Removing the mount takes its row away, so focus moves to the next mount's row.
    await photos.getByRole("button", { name: "Remove" }).tap();
    await page.getByRole("alertdialog").getByRole("button", { name: "Remove mount" }).tap();
    await expect(mount("/photos")).toHaveCount(0);
    await expect(mount("/archive")).toBeFocused();

    // The chevron is a button, so a keyboard opens a row too.
    await page.keyboard.press("Shift+Tab");
    await expect(mount("/shared")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(mount("/shared")).toHaveAttribute("aria-expanded", "true");

    // A mount added again under the removed one's name starts closed.
    await page.getByRole("button", { name: "Add mount", exact: true }).tap();
    const added = page.getByRole("dialog");
    await added.getByLabel("Folder name").fill("photos");
    await added.getByRole("button", { name: "Add mount" }).tap();
    await expect(added).toHaveCount(0);
    await expect(mount("/photos")).toHaveAttribute("aria-expanded", "false");
  });

  test("A revoked key past its expiry: its row says Expired with the date, as an expired key's does", async ({
    page,
  }) => {
    await page.goto("/credentials");
    const main = page.getByRole("main");
    // Before its expiry time a key says Expires instead.
    for (const [name, label, date] of [
      ["Old tablet", "Expired", "Sep 30, 2026"],
      ["Conference laptop", "Expired", "Oct 31, 2026"],
      ["Phone photo backup", "Expires", "May 1, 2027"],
    ] as const) {
      const toggle = main.getByRole("button", { name: `Details for key ${name}`, exact: true });
      await toggle.tap();
      const details = await detailsOf(toggle);
      await expect(details.getByText(label, { exact: true }), name).toBeVisible();
      await expect(details.getByText(date, { exact: true }), name).toBeVisible();
    }
    await expect(main.getByRole("listitem").filter({ hasText: "Old tablet" })).toContainText(
      "Revoked",
    );
  });

  test("Rows that glide: the rows under a row that opens or closes move to their places, at once with reduced motion", async ({
    page,
  }) => {
    for (const motion of ["no-preference", "reduce"] as const) {
      await page.emulateMedia({ reducedMotion: motion });
      await page.goto("/credentials");
      await expect(page.getByRole("main").getByRole("listitem")).toHaveCount(5);
      // The first tap opens "Old tablet", which moves the row under it down, and the second
      // closes it, which moves that row back up.
      for (const tap of ["opening", "closing"] as const) {
        const places = await page.evaluate(placesWhileToggling);
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
    await page.goto("/credentials");
    const row = page
      .getByRole("main")
      .getByRole("listitem")
      .filter({ hasText: "Accountant, invoices only" });
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

  test("Opening an error in the list: a tap shows an error's details under its line, and another hides them", async ({
    page,
  }) => {
    await page.setViewportSize({ width: PHONE_WIDTH, height: 812 });
    await page.goto("/");
    const panel = errorsPanel(page);
    const toggle = (name: string) =>
      panel.getByRole("button", { name: `Details for ${name}`, exact: true });
    const rows = panel.getByRole("listitem");
    await expect(rows).toHaveCount(4);
    const title = await boxOf(panel.getByRole("heading", { name: "Recent operation errors" }));
    // Each error keeps to one line in the window, starting where the title does: its cause and
    // its age share the line with its name.
    for (const row of await rows.all()) {
      expect(await insideWindow(row, PHONE_WIDTH)).toBe(true);
      const start = await row
        .getByRole("img")
        .first()
        .evaluate((icon) => (icon.closest(".astryx-stack") ?? icon).getBoundingClientRect().left);
      expect(Math.abs(start - title.x), "the line starts where the title does").toBeLessThanOrEqual(
        1,
      );
      const cause = await middleOf(row.getByRole("img").first());
      expect(Math.abs(cause - (await middleOf(row.getByText(/^\d+[mh]$/))))).toBeLessThanOrEqual(2);
      // Every line starts closed.
      await expect(row.getByRole("button", { name: /^Details for / })).toHaveAttribute(
        "aria-expanded",
        "false",
      );
    }
    // A name cut short keeps its extension whole.
    const extension = panel.getByText(".zst", { exact: true });
    await expect(extension).toBeVisible();
    expect(await extension.evaluate((node) => node.scrollWidth <= node.clientWidth)).toBe(true);
    expect(await insideWindow(extension, PHONE_WIDTH)).toBe(true);

    // A tap anywhere on the line opens it, not only on its chevron.
    await panel.getByRole("img", { name: "Timed out", exact: true }).tap();
    const archive = await detailsOf(toggle("2026-11-16.tar.zst"));
    await expect(archive).toBeVisible();
    await expect(
      panel.getByRole("group", { name: "Details for 2026-11-16.tar.zst" }),
    ).toBeVisible();
    for (const words of ["504", "Timed out", "/archive/2026-11-16.tar.zst"]) {
      await expect(archive.getByText(words, { exact: true })).toBeVisible();
    }
    await expect(archive.getByRole("img", { name: "PUT", exact: true })).toBeVisible();
    await expect(archive.getByText(/did not answer within 30/)).toBeVisible();
    await settle(page);
    expect(await insideWindow(archive, PHONE_WIDTH)).toBe(true);

    // Several stay open at once, and a second tap closes its own line alone.
    await panel.getByRole("img", { name: "Too large", exact: true }).tap();
    await expect(toggle("holiday.mov")).toHaveAttribute("aria-expanded", "true");
    await expect(toggle("2026-11-16.tar.zst")).toHaveAttribute("aria-expanded", "true");
    await panel.getByRole("img", { name: "Timed out", exact: true }).tap();
    await expect(toggle("2026-11-16.tar.zst")).toHaveAttribute("aria-expanded", "false");
    await expect(toggle("holiday.mov")).toHaveAttribute("aria-expanded", "true");
    await expect(archive).toBeHidden();

    // A held line draws a rounded background inside the card, not a band across it.
    const budget = rows.filter({ hasText: "budget-2027.xlsx" });
    const box = await boxOf(budget);
    const touch = await page.context().newCDPSession(page);
    await touch.send("Input.dispatchTouchEvent", {
      type: "touchStart",
      touchPoints: [{ x: box.x + box.width / 2, y: box.y + box.height / 2 }],
    });
    await expect.poll(() => budget.evaluate(pressedBackground)).not.toBeNull();
    const pressed = await budget.evaluate(pressedBackground);
    expect(pressed?.radius).toBeGreaterThan(0);
    expect(pressed?.inset).toBeGreaterThan(0);
    await touch.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
  });

  test("Opening a tile: a tap shows an error's details beside its tile, and Escape returns to the tile", async ({
    page,
  }) => {
    await page.goto("/");
    const panel = errorsPanel(page);
    await panel.getByRole("radio", { name: "Tiles" }).tap();
    const tile = (name: RegExp) => panel.getByRole("button", { name });
    // A tile is the card that holds its button. The button itself is hidden, a pixel wide.
    const card = (name: RegExp) => tile(name).locator("..");
    const tiles = [
      /^2026-11-16\.tar\.zst, /,
      /^Drafts, /,
      /^budget-2027\.xlsx, /,
      /^holiday\.mov, /,
    ];
    const [first, second, third] = await Promise.all(tiles.map((name) => boxOf(card(name))));
    if (first === undefined || second === undefined || third === undefined) {
      throw new Error("The tiles are missing.");
    }
    // Two tiles side by side, and the next two under them.
    expect(Math.abs(first.y - second.y)).toBeLessThanOrEqual(1);
    expect(second.x).toBeGreaterThanOrEqual(first.x + first.width);
    expect(third.y).toBeGreaterThanOrEqual(first.y + first.height);
    // Each name keeps its extension whole inside the window. The details of each tile wait in the
    // page, hidden, until it opens, so only the tiles' own names are on screen.
    for (const extension of [".zst", ".xlsx", ".mov"]) {
      const text = panel.getByText(extension, { exact: true }).filter({ visible: true });
      expect(await text.evaluate((node) => node.scrollWidth <= node.clientWidth), extension).toBe(
        true,
      );
      expect(await insideWindow(text, 375), extension).toBe(true);
    }

    // The tile's face lies over its button and takes the tap.
    const drafts = tile(/^Drafts, Already exists, 47 minutes ago$/);
    await drafts.tap({ force: true });
    const details = page.getByRole("dialog", { name: "Drafts" });
    await expect(details).toBeVisible();
    for (const words of ["412", "Already exists", "/documents/Drafts → /shared/Drafts"]) {
      await expect(details.getByText(words, { exact: true })).toBeVisible();
    }
    await expect(details.getByRole("img", { name: "MOVE", exact: true })).toBeVisible();
    await expect(details.getByText(/already has Drafts/)).toBeVisible();
    // Beside the tile: just above or just below it, over the same columns.
    const at = await boxOf(details);
    const of = await boxOf(card(/^Drafts, Already exists, 47 minutes ago$/));
    const apart = Math.min(Math.abs(at.y + at.height - of.y), Math.abs(of.y + of.height - at.y));
    expect(apart).toBeLessThanOrEqual(16);
    expect(at.x).toBeLessThan(of.x + of.width);
    expect(at.x + at.width).toBeGreaterThan(of.x);

    await page.keyboard.press("Escape");
    await expect(details).toBeHidden();
    await expect(drafts).toBeFocused();
  });

  test("Holding a marker: a finger shows an error's details above the timeline while it holds", async ({
    page,
  }) => {
    await page.goto("/");
    await errorsPanel(page).getByRole("radio", { name: "Timeline" }).tap();
    const chart = errorTimeline(page);
    await chart.evaluate((element) => element.scrollIntoView({ block: "center" }));
    await expect(errorMarkers(page)).toHaveCount(4);
    // The fourth sample error, the holiday video, is the oldest and lies furthest left.
    const { x, y, width } = await boxOf(errorMarkers(page).nth(3));
    const holiday = { x: x + width / 2, y: y + width / 2 };
    const session = await page.context().newCDPSession(page);
    const finger = (type: "touchStart" | "touchEnd", at?: { x: number; y: number }) =>
      session.send("Input.dispatchTouchEvent", { type, touchPoints: at === undefined ? [] : [at] });
    const details = page.getByRole("status", { name: /^holiday\.mov\s+Status: 413 Too large/ });

    await finger("touchStart", holiday);
    await expect(details).toBeVisible();
    await expect(details.getByText("413", { exact: true })).toBeVisible();
    const top = (await boxOf(chart)).y;
    // Once placed, they sit above the plot, where the finger does not cover them.
    await expect
      .poll(async () => {
        const shownAt = await boxOf(details);
        return shownAt.y + shownAt.height;
      })
      .toBeLessThanOrEqual(top);
    await finger("touchEnd");
    await expect(details).toBeHidden();
  });

  test("Holding a chart: a finger shows a bar's values only while it holds the chart, above the chart", async ({
    page,
  }) => {
    await page.goto("/");
    const chart = page.getByRole("img", { name: "Bytes stored on each backend" });
    await chart.evaluate((element) => element.scrollIntoView({ block: "center" }));
    const values = page.getByRole("status", { name: /Stored: / });
    const { x, y, width, height } = await boxOf(chart);
    // A row per backend, largest first.
    const archive = { x: x + width / 2, y: y + height / 6 };
    const photos = { x: x + width / 2, y: y + height / 2 };
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
    await expect(values).toHaveAccessibleName(/^RustFS archive /);
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
    await expect(values).toHaveAccessibleName(/^R2 photos /);
    expect(await scrollOf(chart)).toBe(scrolled);

    // Lifting the finger hides the values.
    await finger("touchEnd");
    await expect(values).toBeHidden();

    // A swipe that starts on the chart scrolls the page and shows nothing, not for a single frame.
    seen = await watchStoredValues(page);
    await session.send("Input.synthesizeScrollGesture", {
      ...archive,
      yDistance: -200,
      gestureSourceType: "touch",
    });
    expect(await scrollOf(chart)).toBeGreaterThan(scrolled + 100);
    expect(await seen()).toBe(false);
    await expect(values).toBeHidden();
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

test("Status colors: statuses, failed hours and destructive actions take their status colors", async ({
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

  await expect(iconBeside("Unreachable", "error")).toHaveCount(1);
  expect(await computed(iconBeside("Unreachable", "error"), "color")).toBe(
    await tokenColor(page, "--color-icon-error"),
  );
  await expect(iconBeside("Connected", "success")).toHaveCount(1);
  expect(await computed(iconBeside("Connected", "success"), "color")).toBe(
    await tokenColor(page, "--color-icon-success"),
  );

  // A ring on each of the 3 hours with a failed operation.
  const rings = page
    .getByRole("img", { name: "Operations per hour, last 24 hours" })
    .locator("circle");
  await expect(rings).toHaveCount(3);
  for (const ring of await rings.all()) {
    expect(await computed(ring, "stroke")).toBe(await tokenColor(page, "--color-error"));
  }

  // The status code of each recent operation error, in its details.
  for (const name of ["2026-11-16.tar.zst", "Drafts", "budget-2027.xlsx", "holiday.mov"]) {
    await main.getByRole("button", { name: `Details for ${name}`, exact: true }).click();
  }
  for (const code of ["504", "412", "423", "413"]) {
    expect(await computed(main.getByText(code, { exact: true }), "color"), code).toBe(
      await tokenColor(page, "--color-text-error"),
    );
  }
  // The disc of each error's cause takes the error color's muted shade under its own ink, and so
  // does each marker of the timeline.
  for (const cause of ["Timed out", "Already exists", "Locked", "Too large"]) {
    const disc = await main.getByRole("img", { name: cause, exact: true }).evaluate((icon) => {
      const style = getComputedStyle(icon.closest(".astryx-stack") ?? icon);
      return { background: style.backgroundColor, ink: style.color };
    });
    expect(disc, cause).toEqual({
      background: await tokenColor(page, "--color-error-muted"),
      ink: await tokenColor(page, "--color-on-error-muted"),
    });
  }
  // Each marker draws the picture of its own error's cause, the one its line shows in the list:
  // as many shapes, and the same data in each path, where the list's icon keeps shapes such as a
  // rectangle that the timeline draws as paths. The markers' keys carry the sample errors' ids.
  const pictures = new Map<string, { shapes: number; paths: string[] }>();
  for (const [id, cause] of [
    ["e1", "Timed out"],
    ["e2", "Already exists"],
    ["e3", "Locked"],
    ["e4", "Too large"],
  ] as const) {
    const icon = main.getByRole("img", { name: cause, exact: true });
    pictures.set(
      id,
      await icon.evaluate((node) => ({
        shapes: node.querySelectorAll("path, line, circle, ellipse, rect, polyline, polygon")
          .length,
        paths: [...node.querySelectorAll("path")].map((path) => path.getAttribute("d") ?? ""),
      })),
    );
  }
  await main.getByRole("radio", { name: "Timeline" }).click();
  await expect(errorMarkers(page)).toHaveCount(4);
  for (const marker of await errorMarkers(page).all()) {
    expect(await computed(marker, "fill")).toBe(await tokenColor(page, "--color-error-muted"));
  }
  for (const [id, picture] of pictures) {
    const drawn = errorTimeline(page).locator(`path[data-ts-key*=":${id}:glyph:"]`);
    await expect(drawn, id).toHaveCount(picture.shapes);
    const data = await drawn.evaluateAll((paths) => paths.map((path) => path.getAttribute("d")));
    expect(data, id).toEqual(expect.arrayContaining(picture.paths));
  }
  // The picture of each cause is drawn in lines of the ink, with nothing filled.
  const glyphs = errorTimeline(page).locator('path[data-ts-key*=":glyph:"]');
  for (const glyph of await glyphs.all()) {
    expect(await computed(glyph, "fill")).toBe("none");
    expect(await computed(glyph, "stroke")).toBe(await tokenColor(page, "--color-on-error-muted"));
  }

  // Astryx fills a destructive button with the error color's muted shade, under its own text:
  // the Delete of a selection, the Delete in a file's details and a confirmation's action.
  const destructive = async (button: Locator) => {
    expect(await computed(button, "background-color")).toBe(
      await tokenColor(page, "--color-error-muted"),
    );
    expect(await computed(button, "color")).toBe(await tokenColor(page, "--color-on-error-muted"));
  };
  await page.goto("/files?path=%2Fshared");
  await selectFirstRow(page);
  await destructive(main.getByRole("button", { name: "Delete", exact: true }));
  await page.goto(PREVIEW);
  await shown(page.getByRole("heading", { name: "Preview" }));
  await destructive(main.getByRole("button", { name: "Delete", exact: true }));

  await page.goto("/storage");
  await page.getByRole("button", { name: "Actions for mount /photos" }).click();
  await page.getByRole("menuitem", { name: "Remove" }).click();
  await destructive(page.getByRole("alertdialog").getByRole("button", { name: "Remove mount" }));

  // The error notification draws on Astryx's own red, whose text reaches 4.5:1 in either mode.
  for (const colorScheme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme });
    await page.goto("/");
    // The token resolves in the page's own mode, so the mode is checked before it is trusted.
    expect(await page.evaluate(bodyIsDark), colorScheme).toBe(colorScheme === "dark");
    await page.getByRole("button", { name: "Check connections" }).click();
    const { color, background } = await textOnBackground(onScreen(page, /still unreachable/));
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
  await page.goto("/files?path=%2Fdocuments");

  const name =
    "an-export-from-the-old-nas-with-a-very-long-file-name-that-keeps-going-2026-11-16.log";
  await expect(page.getByRole("link", { name, exact: true })).toBeVisible();
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

test("The operations chart in words: it describes the failures and the busiest hour", async ({
  page,
}) => {
  await page.goto("/");
  await shown(page.getByRole("img", { name: "Operations per hour, last 24 hours" }));
  expect((await imageDescriptions(page)).get("Operations per hour, last 24 hours")).toBe(
    "3,732 operations, 4 of them failed, 5 hours ago, 1 hour ago, and now. The busiest hour was 12 hours ago, with 426.",
  );
});

test("The storage chart in words: it names the bytes on each backend", async ({ page }) => {
  await page.goto("/");
  await shown(page.getByRole("img", { name: "Bytes stored on each backend" }));
  expect((await imageDescriptions(page)).get("Bytes stored on each backend")).toBe(
    "RustFS archive stores 212 GB, R2 photos stores 41.2 GB, and Durable Objects stores 1.9 GB.",
  );
});

test("A rejected upload: an error shows its cause, its name and its age, and its details on demand", async ({
  page,
}) => {
  await page.goto("/");
  const panel = errorsPanel(page);
  const row = panel.getByRole("listitem").filter({ hasText: "holiday.mov" });
  await expect(row.getByRole("img", { name: "Too large", exact: true })).toBeVisible();
  await expect(row.getByText("5h", { exact: true })).toBeVisible();
  // Assistive technology hears the age in words, and not its short form.
  await expect(row).toMatchAriaSnapshot(`
    - listitem:
      - img "Too large"
      - text: holiday.mov 5 hours ago
  `);
  // The details wait for a tap: no status code, request or reason shows before it.
  await expect(panel.getByText("413", { exact: true })).toHaveCount(0);
  await expect(panel.getByText(/Cloudflare Free/)).toHaveCount(0);

  const toggle = panel.getByRole("button", { name: "Details for holiday.mov", exact: true });
  await toggle.click();
  const details = await detailsOf(toggle);
  const code = details.getByText("413", { exact: true });
  await expect(code).toBeVisible();
  expect(await computed(code, "color")).toBe(await tokenColor(page, "--color-text-error"));
  await expect(details.getByText("Too large", { exact: true })).toBeVisible();
  await expect(details.getByRole("img", { name: "PUT", exact: true })).toBeVisible();
  await expect(details.getByText("/photos/2026/holiday.mov", { exact: true })).toBeVisible();
  await expect(
    details.getByText(/^Uploads over 100\sMB do not fit one request on Cloudflare Free\.$/),
  ).toBeVisible();
  await expect(details.getByText("5 hours ago", { exact: true })).toBeVisible();
});

test("Choosing a view: the list shows first, and the view chosen lasts for the visit", async ({
  page,
}) => {
  await page.goto("/");
  const panel = errorsPanel(page);
  const views = panel.getByRole("radiogroup", { name: "Show errors as" });
  const view = (name: string) => views.getByRole("radio", { name, exact: true });
  await expect(view("List")).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("button", { name: "Details for holiday.mov" })).toBeVisible();
  await expect(errorTimeline(page)).toHaveCount(0);
  // Each choice is a picture, named for assistive technology and in a tooltip. The tooltip repeats
  // the name, so it does not describe the choice too, and a screen reader reads the word once.
  for (const name of ["List", "Timeline", "Tiles"]) {
    await expect(view(name)).toHaveText("");
    await view(name).hover();
    await expect(page.getByRole("tooltip").filter({ hasText: name })).toBeVisible();
    await expect(view(name)).toHaveAccessibleDescription("");
  }

  await view("Timeline").click();
  await expect(errorTimeline(page)).toBeVisible();
  await expect(panel.getByRole("listitem")).toHaveCount(0);
  await sideNavigation(page).getByRole("link", { name: "Files" }).click();
  await expect(levelOne(page)).toHaveText("Files");
  await sideNavigation(page).getByRole("link", { name: "Overview" }).click();
  await expect(view("Timeline")).toHaveAttribute("aria-checked", "true");
  await expect(errorTimeline(page)).toBeVisible();

  await page.reload();
  await expect(view("List")).toHaveAttribute("aria-checked", "true");
  await expect(panel.getByRole("button", { name: "Details for holiday.mov" })).toBeVisible();
  await expect(errorTimeline(page)).toHaveCount(0);
});

/**
 * The timeline's axis runs on the panel's grid: from the line where the panel's title starts to the
 * end of the panel's content, which the chart spans. A horizontal line has no height, so its edges
 * are read from the page rather than from a visible box.
 */
const expectAxisOnGrid = async (page: Page): Promise<void> => {
  const panel = errorsPanel(page);
  const title = await boxOf(panel.getByRole("heading", { name: "Recent operation errors" }));
  const chart = await boxOf(errorTimeline(page));
  const axis = await errorTimeline(page)
    .locator('line[data-ts-key$=":axis"]')
    .evaluate((line) => {
      const edges = line.getBoundingClientRect();
      return { start: edges.left, end: edges.right };
    });
  expect(
    Math.abs(axis.start - title.x),
    "the axis starts where the title does",
  ).toBeLessThanOrEqual(1);
  expect(
    Math.abs(axis.end - (chart.x + chart.width)),
    "the axis ends with the panel",
  ).toBeLessThanOrEqual(1);
};

/** Moves keyboard focus with Tab until `target` has it, as a keyboard user reaches it. */
const tabTo = async (page: Page, target: Locator): Promise<void> => {
  for (let step = 0; step < 40; step += 1) {
    if (await target.evaluate((node) => node === document.activeElement)) {
      return;
    }
    await page.keyboard.press("Tab");
  }
  await expect(target).toBeFocused();
};

test("Reading the timeline: the errors lie along the last day, the last hour over half of it, and each shows its details", async ({
  page,
}) => {
  await page.goto("/");
  await errorsPanel(page).getByRole("radio", { name: "Timeline" }).click();
  const chart = errorTimeline(page);
  await chart.scrollIntoViewIfNeeded();
  await expect(errorMarkers(page)).toHaveCount(4);
  const centers = await markerCenters(page);
  // The markers keep the order of the sample errors: 12, 47, 95 and 310 minutes ago.
  const [archive, drafts, budget, holiday] = centers;
  if (
    archive === undefined ||
    drafts === undefined ||
    budget === undefined ||
    holiday === undefined
  ) {
    throw new Error("The timeline has fewer than four markers.");
  }
  expect(holiday.x).toBeLessThan(budget.x);
  expect(budget.x).toBeLessThan(drafts.x);
  expect(drafts.x).toBeLessThan(archive.x);
  // The last hour, from the tick marked 1h to Now, takes more than half of the width, with the
  // two errors of the last hour in it and the older ones before it.
  const hour = await boxOf(chart.getByText("1h", { exact: true }));
  const now = await boxOf(chart.getByText("Now", { exact: true }));
  const hourAt = hour.x + hour.width / 2;
  const plot = await boxOf(chart);
  expect(hourAt).toBeLessThan(plot.x + plot.width / 2);
  expect(now.x + now.width).toBeGreaterThan(plot.x + plot.width * 0.9);
  for (const recent of [archive, drafts]) {
    expect(recent.x, "an error of the last hour").toBeGreaterThan(hourAt);
  }
  for (const older of [budget, holiday]) {
    expect(older.x, "an older error").toBeLessThan(hourAt);
  }
  centers.forEach((one, first) => {
    for (const other of centers.slice(first + 1)) {
      expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeGreaterThanOrEqual(
        one.radius + other.radius,
      );
    }
  });
  await expectAxisOnGrid(page);

  // Pointing at a marker shows its error's name and details.
  await page.mouse.move(budget.x, budget.y);
  const details = page.getByRole("status", { name: /^budget-2027\.xlsx\s+Status: 423 Locked/ });
  await expect(details).toBeVisible();
  await expect(details).toContainText("budget-2027.xlsx");
  for (const words of ["423", "Locked", "/documents/budget-2027.xlsx"]) {
    await expect(details.getByText(words, { exact: true })).toBeVisible();
  }
  // They show above the plot, once placed, on a surface of the popover's color, as the charts'
  // tooltips do.
  await expect
    .poll(async () => {
      const shownAt = await boxOf(details);
      return shownAt.y + shownAt.height;
    })
    .toBeLessThanOrEqual(plot.y);
  const surface = await details.evaluate((node) => {
    const painted = [node, ...node.querySelectorAll("*")].find(
      (element) => getComputedStyle(element).backgroundColor !== "rgba(0, 0, 0, 0)",
    );
    return painted === undefined ? null : getComputedStyle(painted).backgroundColor;
  });
  expect(surface).toBe(await tokenColor(page, "--color-background-popover"));

  // The keyboard reaches the oldest error first, and each arrow key the next one.
  await page.mouse.move(0, 0);
  await tabTo(page, chart);
  for (const [step, name] of [
    [0, /^holiday\.mov\s/],
    [1, /^budget-2027\.xlsx\s/],
    [2, /^Drafts\s/],
    [3, /^2026-11-16\.tar\.zst\s/],
  ] as const) {
    if (step > 0) {
      await page.keyboard.press("ArrowRight");
    }
    await expect(page.getByRole("status", { name })).toBeVisible();
  }

  // In the narrowest window the markers stack rather than cover each other. The chart draws again
  // for its new width, so the markers are read once they stay where they are.
  await page.setViewportSize({ width: PHONE_WIDTH, height: 812 });
  await expect.poll(async () => (await boxOf(chart)).width).toBeLessThan(PHONE_WIDTH);
  let narrow = await markerCenters(page);
  await expect
    .poll(async () => {
      const before = JSON.stringify(narrow);
      await nextFrame(page);
      narrow = await markerCenters(page);
      return JSON.stringify(narrow) === before;
    })
    .toBe(true);
  expect(narrow).toHaveLength(4);
  narrow.forEach((one, first) => {
    for (const other of narrow.slice(first + 1)) {
      expect(Math.hypot(one.x - other.x, one.y - other.y)).toBeGreaterThanOrEqual(
        one.radius + other.radius,
      );
    }
  });
  await expectAxisOnGrid(page);
});

test("The timeline in words: it names each error's file, cause and age", async ({ page }) => {
  await page.goto("/");
  await errorsPanel(page).getByRole("radio", { name: "Timeline" }).click();
  await expect(errorTimeline(page)).toBeVisible();
  expect((await imageDescriptions(page)).get("Operation errors, last 24 hours")).toBe(
    "4 operations failed in the last 24 hours. holiday.mov: too large, 5 hours ago. budget-2027.xlsx: locked, 2 hours ago. Drafts: already exists, 47 minutes ago. 2026-11-16.tar.zst: timed out, 12 minutes ago.",
  );
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

test("The address field's name: a screen reader hears the field's label alone", async ({
  page,
}) => {
  await page.goto("/");
  await expect(page.getByRole("textbox", { name: "WebDAV address", exact: true })).toHaveValue(
    /^https:\/\//,
  );
});

test("The WebDAV section's address field: a screen reader hears its label alone", async ({
  page,
}) => {
  await page.goto("/settings?section=webdav");
  await expect(page.getByRole("textbox", { name: "Address", exact: true })).toHaveValue(
    /^https:\/\//,
  );
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

  test("Folding the navigation on Settings: the open section keeps what was typed and finishes an export", async ({
    page,
  }) => {
    // Beside the navigation at its default width, a window 1000 px wide leaves a narrow page.
    await page.setViewportSize({ width: 1000, height: 800 });
    const sections = page.getByRole("navigation", { name: "Settings sections" });
    const selector = page.getByRole("combobox", { name: "Section" });
    await page.goto("/settings?section=profile");
    await expect(selector).toBeVisible();
    const field = page.getByRole("textbox", { name: "Display name" });
    await field.fill("Edited but unsaved");
    await sideNavigation(page).getByRole("button", { name: "Collapse sidebar" }).click();
    await expect(sections).toBeVisible();
    await expect(field).toHaveValue("Edited but unsaved");

    // An export started before the navigation opens again still says it finished.
    await page.goto("/settings?section=export");
    await page.getByRole("button", { name: "Export" }).click();
    await sideNavigation(page).getByRole("button", { name: "Expand sidebar" }).click();
    await expect(selector).toBeVisible();
    await shown(onScreen(page, /^Exported davloom-export/));
  });
});
