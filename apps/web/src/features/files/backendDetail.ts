import type { Backend } from "../api/queries";

const FAILURES: Record<string, string> = {
  unavailable: "no answer",
  "insufficient-storage": "a full store",
};

const durationOf = (ms: number): string =>
  ms < 1000
    ? `${new Intl.NumberFormat("en").format(Math.round(ms))} ms`
    : `${new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(ms / 1000)} s`;

/**
 * How a backend answered when the list of backends was read, as the rest of "Main storage …":
 * "answered in 38 ms", "gave no answer after 30 s", or that its saved settings do not open it.
 */
export const backendDetail = (backend: Pick<Backend, "available" | "status">): string => {
  const status = backend.status;
  if (status === undefined) {
    return backend.available ? "answered" : "gave no answer";
  }
  switch (status.state) {
    case "answered":
      return `answered in ${durationOf(status.ms)}`;
    case "failed":
      return `gave ${FAILURES[status.failure] ?? status.failure} after ${durationOf(status.ms)}`;
    default:
      return "cannot be opened with its saved settings";
  }
};
