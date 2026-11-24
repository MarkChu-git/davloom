// What the metered Worker (entry.workers.ts) reports about the request before, at USAGE_PATH.

export const USAGE_PATH = "/__quota/usage";

export interface Usage {
  /** D1 statements: the Free plan allows 50 queries per invocation, each one in a batch included. */
  d1Queries: number;
  /** D1 calls (a statement, or a batch of them), which count as internal subrequests. */
  d1Calls: number;
  d1RowsRead: number;
  d1RowsWritten: number;
  /** Calls on Durable Object stubs: internal subrequests, and requests on the daily quota. */
  objectCalls: number;
  objectRowsRead: number;
  objectRowsWritten: number;
  /** fetch() to the internet: the Free plan allows 50 per invocation. */
  externalFetches: number;
}
