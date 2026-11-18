import { expect, test, type Page } from "@playwright/test";
import { DEV_SERVER_ORIGIN } from "./devServer";

// The owner reviews pages on `vite dev`, so the dev server has to draw them as the build does.
// Each page opens on the Bun build and on the dev server at the same size and color scheme, and
// every element that renders is compared by its box and a few computed styles.

const PAGES = ["/", "/files?path=%2Fdocuments", "/credentials", "/storage", "/settings"];

const VIEWS = [
  { width: 1280, height: 900, colorScheme: "light" },
  { width: 1280, height: 900, colorScheme: "dark" },
  { width: 375, height: 812, colorScheme: "light" },
] as const;

const STYLES = [
  "display",
  "color",
  "background-color",
  "border-top-color",
  "border-top-width",
  "font-size",
  "font-weight",
];

/** Elements that never draw anything, and that the two servers add in different numbers. */
const NOT_DRAWN = "script, style, link, meta, template, noscript";

interface Shape {
  /** The start of the element's text, which names it in a failure better than its path. */
  text: string;
  box: number[];
  styles: string[];
}

// One worker opens the pages one after another, so a dependency that Vite optimizes late reloads
// no other test's page. A failure still lets the remaining pages run.
test.describe.configure({ mode: "default" });

/** Opens a page and waits until it stops loading and, on the dev server, StyleX stops adding rules. */
const open = async (page: Page, url: string) => {
  await page.goto(url);
  await page.waitForLoadState("networkidle");
  await page.evaluate(() => document.fonts.ready);
  // The plugin's dev runtime writes the rules compiled so far into this element and adds more as
  // modules compile. The build has no such element, so its size stays 0.
  let previous = -1;
  await expect
    .poll(
      async () => {
        const size = await page.evaluate(
          () => document.getElementById("__stylex_virtual__")?.textContent?.length ?? 0,
        );
        const settled = size === previous;
        previous = size;
        return settled;
      },
      { intervals: [300] },
    )
    .toBe(true);
};

/** Every drawn element in <body>, keyed by its position among drawn siblings. */
const shapesOf = (page: Page): Promise<Record<string, Shape>> =>
  page.evaluate(
    ({ styles, notDrawn }) => {
      const drawn = (element: Element) => !element.matches(notDrawn);
      const pathOf = (element: Element) => {
        const steps: string[] = [];
        for (let node = element; node !== document.body; node = node.parentElement!) {
          const index = [...node.parentElement!.children].filter(drawn).indexOf(node) + 1;
          steps.unshift(`${node.tagName.toLowerCase()}:nth-child(${index})`);
        }
        return steps.join(" > ");
      };
      const shapes: Record<string, Shape> = {};
      for (const element of document.body.querySelectorAll("*")) {
        if (!drawn(element) || element.closest(notDrawn)) {
          continue;
        }
        const box = element.getBoundingClientRect();
        const computed = getComputedStyle(element);
        shapes[pathOf(element)] = {
          text: (element.textContent ?? "").trim().slice(0, 24),
          box: [box.x, box.y, box.width, box.height].map((value) => Math.round(value)),
          styles: styles.map((name) => computed.getPropertyValue(name)),
        };
      }
      return shapes;
    },
    { styles: STYLES, notDrawn: NOT_DRAWN },
  );

/** The last three steps of a path and the element's text, which together find it on the page. */
const nameOf = (path: string, shape: Shape) => {
  const steps = path.split(" > ");
  const tail = steps.length > 3 ? `… > ${steps.slice(-3).join(" > ")}` : path;
  return shape.text ? `${tail} "${shape.text}"` : tail;
};

/** What differs between the two servers, at most ten lines of it. */
const differences = (build: Record<string, Shape>, dev: Record<string, Shape>): string[] => {
  const lines: string[] = [];
  for (const [path, expected] of Object.entries(build)) {
    const actual = dev[path];
    if (!actual) {
      lines.push(`${nameOf(path, expected)}: missing on the dev server`);
      continue;
    }
    // Text can land half a pixel apart where a box is centered, so allow a pixel.
    const moved = expected.box.some((value, index) => Math.abs(value - actual.box[index]!) > 1);
    const styled = STYLES.flatMap((name, index) =>
      expected.styles[index] === actual.styles[index]
        ? []
        : [`${name} ${expected.styles[index]} -> ${actual.styles[index]}`],
    );
    if (moved || styled.length > 0) {
      const box = moved ? [`box ${expected.box.join(",")} -> ${actual.box.join(",")}`] : [];
      lines.push(`${nameOf(path, expected)}: ${[...box, ...styled].join("; ")}`);
    }
  }
  for (const [path, shape] of Object.entries(dev)) {
    if (!(path in build)) {
      lines.push(`${nameOf(path, shape)}: only on the dev server`);
    }
  }
  return lines.slice(0, 10);
};

test.beforeAll(async ({ browser }) => {
  // The first visit makes Vite compile each page's modules and optimize their dependencies.
  const page = await browser.newPage();
  for (const path of PAGES) {
    await open(page, `${DEV_SERVER_ORIGIN}${path}`);
  }
  await page.close();
});

for (const path of PAGES) {
  test(`The same page on both servers: ${path}`, async ({ page, baseURL }) => {
    for (const { width, height, colorScheme } of VIEWS) {
      await page.setViewportSize({ width, height });
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      await open(page, `${baseURL}${path}`);
      const build = await shapesOf(page);
      await open(page, `${DEV_SERVER_ORIGIN}${path}`);
      const dev = await shapesOf(page);
      expect(differences(build, dev), `${path} at ${width} px, ${colorScheme}`).toEqual([]);
    }
  });
}
