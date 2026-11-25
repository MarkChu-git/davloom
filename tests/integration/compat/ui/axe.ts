import { AxeBuilder } from "@axe-core/playwright";
import type { Page } from "@playwright/test";

// The accessibility audit (PRD §11, UI-specific tests): axe-core's rules for WCAG 2.2 at levels A
// and AA, and its best practices, run on the page as it stands.

/** The rule tags the audit runs: every WCAG A and AA rule up to 2.2, and the best practices. */
export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
] as const;

interface KnownFinding {
  readonly rule: string;
  /** Whether a reported element is the one this finding is about, from its HTML. */
  readonly matches: (html: string) => boolean;
  readonly why: string;
}

/**
 * Best-practice findings the audit lets through, each for one element and a reason. Every WCAG
 * rule still fails the audit wherever it fires, and so does any other best-practice finding.
 */
export const KNOWN_FINDINGS: readonly KnownFinding[] = [
  {
    rule: "region",
    matches: (html) => html.includes("astryx-resize-handle"),
    why: "Astryx's AppShell renders the sidebar's resize handle outside its navigation landmark, and dependency source is not patched (CLAUDE.md, UI rules).",
  },
  {
    rule: "label-title-only",
    // axe shortens the HTML it reports, so the header's field, whose frame slot comes first,
    // may be cut before its value.
    matches: (html) =>
      html.includes('data-frame-slot="webdav-address"') ||
      (html.includes("readonly") && html.includes('/dav/"')),
    why: "The Overview's header hides the WebDAV address field's label; the field keeps its name through aria-labelledby, and axe asks for a visible one once the copy warning describes it.",
  },
];

const isKnown = (rule: string, html: string): boolean =>
  KNOWN_FINDINGS.some((known) => known.rule === rule && known.matches(html));

/**
 * What axe-core finds wrong on the page, one line per rule and element, so that a failure names
 * the rule, its impact and where it failed.
 */
export const axeViolations = async (page: Page): Promise<string[]> => {
  const { violations } = await new AxeBuilder({ page }).withTags([...AXE_TAGS]).analyze();
  return violations.flatMap((violation) =>
    violation.nodes
      .filter((node) => !isKnown(violation.id, node.html))
      .map(
        (node) =>
          `${violation.id} (${violation.impact ?? "unknown"}): ${violation.help} at ${node.target.join(" ")}`,
      ),
  );
};
