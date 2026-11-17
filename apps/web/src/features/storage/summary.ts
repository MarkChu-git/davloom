import { backends, type BackendStatus } from "../sample-data/data";
import type { Tone } from "../shell/StatusLabel";
import { BACKEND_STATUS } from "./backendStatus";

// Totals over the sample backends, shared by the Overview and the side navigation so that both
// show the same numbers.

export const usedBytes = backends.reduce((sum, backend) => sum + backend.usedBytes, 0);

const limited = backends.filter((backend) => backend.capacityBytes !== undefined);

/** The bytes stored on the backends that report a capacity. */
export const knownUsed = limited.reduce((sum, backend) => sum + backend.usedBytes, 0);

/** The total capacity of the backends that report one. */
export const knownCapacity = limited.reduce(
  (sum, backend) => sum + (backend.capacityBytes ?? 0),
  0,
);

export const objectCount = backends.reduce((sum, backend) => sum + backend.objectCount, 0);

export const unreachable = backends.filter((backend) => backend.status === "unreachable");

/** From the mildest status to the most severe. */
const STATUS_ORDER = [
  "connected",
  "degraded",
  "unreachable",
] as const satisfies readonly BackendStatus[];

const countIn = (status: BackendStatus): number =>
  backends.filter((backend) => backend.status === status).length;

/** How many backends are in each status, such as "2 connected, 1 unreachable". */
export const connectionSummary = STATUS_ORDER.map((status) => [countIn(status), status] as const)
  .filter(([count]) => count > 0)
  .map(([count, status]) => `${count} ${BACKEND_STATUS[status].label.toLowerCase()}`)
  .join(", ");

/** The most severe status a backend is in, and how many backends are in it. */
export const worstStatus = ((): { status: BackendStatus; count: number } => {
  const status = STATUS_ORDER.findLast((candidate) => countIn(candidate) > 0) ?? "connected";
  return { status, count: countIn(status) };
})();

/**
 * What the side navigation says on every page while a backend is slow or unreachable, such as
 * "1 backend unreachable", and the glyph it shows; absent while every backend answers.
 */
export const storageAlert = ((): { tone: Tone; text: string } | undefined => {
  const { status, count } = worstStatus;
  if (status === "connected") {
    return undefined;
  }
  const { tone, label } = BACKEND_STATUS[status];
  return { tone, text: `${count} ${count === 1 ? "backend" : "backends"} ${label.toLowerCase()}` };
})();
