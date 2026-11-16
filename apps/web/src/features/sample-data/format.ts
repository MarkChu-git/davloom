import { SAMPLE_NOW } from "./data";

const LOCALE = "en";

const UNITS = [
  ["byte", 1],
  ["kilobyte", 1e3],
  ["megabyte", 1e6],
  ["gigabyte", 1e9],
  ["terabyte", 1e12],
] as const;

/** Decimal units (1 kB = 1,000 bytes), the way operating systems show file sizes. */
export const formatBytes = (bytes: number): string => {
  const [unit, size] = UNITS.findLast(([, step]) => bytes >= step) ?? UNITS[0];
  return new Intl.NumberFormat(LOCALE, {
    style: "unit",
    unit,
    // The short form of "byte" has no plural ("120 byte"), so whole bytes use the long form.
    unitDisplay: unit === "byte" ? "long" : "short",
    maximumFractionDigits: unit === "byte" ? 0 : 1,
  }).format(bytes / size);
};

export const formatCount = (count: number): string => new Intl.NumberFormat(LOCALE).format(count);

const RELATIVE_STEPS = [
  ["minute", 60],
  ["hour", 24],
  ["day", 30],
  ["month", 12],
  ["year", Number.POSITIVE_INFINITY],
] as const;

/** "2 minutes ago", measured from the sample data's fixed clock. */
export const formatRelative = (iso: string): string => {
  let value = (new Date(iso).getTime() - SAMPLE_NOW.getTime()) / 60_000;
  const format = new Intl.RelativeTimeFormat(LOCALE, { numeric: "auto" });
  for (const [unit, next] of RELATIVE_STEPS) {
    if (Math.abs(value) < next) {
      return format.format(Math.round(value), unit);
    }
    value /= next;
  }
  return format.format(Math.round(value), "year");
};

export const formatDate = (iso: string): string =>
  new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium" }).format(new Date(iso));

export const formatDateTime = (iso: string): string =>
  new Intl.DateTimeFormat(LOCALE, { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(iso),
  );
