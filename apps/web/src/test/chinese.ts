import { expect } from "vitest";

/** Names that read the same in Chinese: the product's, the protocol's and the tools'. */
const NAMES = [
  "Davloom",
  "WebDAV",
  "API",
  "Finder",
  "rclone",
  "Cloudflare",
  "Durable Objects",
  "S3",
];

/**
 * Checks that the words the page shows, its accessible names included, are Chinese: the only Latin
 * words left are names that read the same and the test's own data, such as a file's name.
 */
export const expectChinese = (root: HTMLElement, data: readonly string[] = []) => {
  const labels = [...root.querySelectorAll("[aria-label], [placeholder], [title]")].flatMap(
    (element) =>
      ["aria-label", "placeholder", "title"].map((name) => element.getAttribute(name) ?? ""),
  );
  let text = [root.textContent ?? "", ...labels].join("\n");
  for (const word of [...data, ...NAMES].toSorted((a, b) => b.length - a.length)) {
    text = text.replaceAll(word, "");
  }
  expect(text.match(/[A-Za-z]{3,}[^\n]{0,30}/g) ?? []).toEqual([]);
};
