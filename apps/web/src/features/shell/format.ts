import type { Locale } from "../i18n/locale";

const UNITS = [
  ["byte", 1],
  ["kilobyte", 1e3],
  ["megabyte", 1e6],
  ["gigabyte", 1e9],
  ["terabyte", 1e12],
] as const;

/** Decimal units (1 kB = 1,000 bytes), the way operating systems show file sizes. */
export const formatBytes = (bytes: number, locale: Locale): string => {
  const [unit, size] = UNITS.findLast(([, step]) => bytes >= step) ?? UNITS[0];
  return new Intl.NumberFormat(locale, {
    style: "unit",
    unit,
    // The short form of "byte" has no plural ("120 byte"), so whole bytes use the long form.
    unitDisplay: unit === "byte" ? "long" : "short",
    maximumFractionDigits: unit === "byte" ? 0 : 1,
  }).format(bytes / size);
};

export const formatCount = (count: number, locale: Locale): string =>
  new Intl.NumberFormat(locale).format(count);

const RELATIVE_STEPS = [
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
] as const;

/**
 * How far a time lies from `now`: a whole count of the largest unit that keeps it under the next
 * one, such as -2 hours, below zero for a time past.
 */
export const relativeSpan = (
  iso: string,
  now: Date = new Date(),
): { count: number; unit: (typeof RELATIVE_STEPS)[number][0] } => {
  let value = (new Date(iso).getTime() - now.getTime()) / 60_000;
  for (const [unit, next] of RELATIVE_STEPS) {
    if (Math.abs(value) < next) {
      return { count: Math.round(value), unit };
    }
    value /= next;
  }
  return { count: Math.round(value), unit: "year" };
};

/** "2 minutes ago", or "this minute" within half a minute. */
export const formatRelative = (iso: string, locale: Locale, now: Date = new Date()): string => {
  const { count, unit } = relativeSpan(iso, now);
  return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(count, unit);
};

export const formatDate = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(new Date(iso));

export const formatDateTime = (iso: string, locale: Locale): string =>
  new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
