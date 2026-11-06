export interface Distribution {
  readonly count: number;
  readonly p50: number;
  readonly p90: number;
  readonly p99: number;
  readonly max: number;
}

/** Uses the nearest-rank percentile, because a run has at most a few hundred samples. */
export const distributionOf = (values: readonly number[]): Distribution | null => {
  if (values.length === 0) {
    return null;
  }
  const sorted = values.toSorted((a, b) => a - b);
  const percentile = (rank: number): number =>
    sorted[Math.max(Math.ceil((rank / 100) * sorted.length) - 1, 0)] ?? Number.NaN;
  return {
    count: sorted.length,
    p50: percentile(50),
    p90: percentile(90),
    p99: percentile(99),
    max: percentile(100),
  };
};

export const countBy = <T>(values: readonly T[], keyOf: (value: T) => string) => {
  const counts: Record<string, number> = {};
  for (const value of values) {
    const key = keyOf(value);
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
};
