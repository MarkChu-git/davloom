import bend, {
  type BendCode,
  type BendConfirm,
  type BendFailure,
  type BendListing,
  type BendStatus,
} from "./compiled/objects.mjs";

/** The code of an object store's error, sorted into what Davloom tells apart. */
export type ObjectErrorCode =
  | "not-store"
  | "no-such-key"
  | "too-large"
  | "refused-key"
  | "no-code"
  | "unwritable-refusal"
  | "precondition"
  | "full"
  | "other";

export type ObjectFailure =
  | "not-found"
  | "too-large"
  | "name-refused"
  | "exists"
  | "insufficient-storage"
  | "unavailable";

/** What a one-entry listing of a refused key as a prefix showed. */
export type RefusedListing = "shows-key" | "not-key" | "refused" | "failed";
export type RefusedRead = "absent" | "fault" | "listing-failure";

const CODES: Record<ObjectErrorCode, BendCode> = {
  "not-store": { $: "CNotStore" },
  "no-such-key": { $: "CNoSuchKey" },
  "too-large": { $: "CTooLarge" },
  "refused-key": { $: "CRefusedKey" },
  "no-code": { $: "CNoCode" },
  "unwritable-refusal": { $: "CUnwritable" },
  precondition: { $: "CPrecondition" },
  full: { $: "CFull" },
  other: { $: "COther" },
};
const statusOf = (status: number | undefined): BendStatus =>
  status === 400
    ? { $: "S400" }
    : status === 412
      ? { $: "S412" }
      : status === 507
        ? { $: "S507" }
        : { $: "SOther" };
const FAILURES: Record<BendFailure["$"], ObjectFailure> = {
  ONotFound: "not-found",
  OTooLarge: "too-large",
  ONameRefused: "name-refused",
  OExists: "exists",
  OFull: "insufficient-storage",
  OUnavailable: "unavailable",
};
const LISTINGS: Record<RefusedListing, BendListing> = {
  "shows-key": { $: "LShowsKey" },
  "not-key": { $: "LNotKey" },
  refused: { $: "LRefused" },
  failed: { $: "LFailed" },
};
const CONFIRMS: Record<BendConfirm["$"], RefusedRead> = {
  Absent: "absent",
  Fault: "fault",
  ListingFailure: "listing-failure",
};

/**
 * The storage failure for an object store's error with `code` and HTTP `status`, in answer to
 * HEAD when `head` (laws object_error_exact, object_refusal_about_key).
 */
export const classifyObjectError = (
  code: ObjectErrorCode,
  status: number | undefined,
  head: boolean,
): ObjectFailure => FAILURES[bend.classify(CODES[code], statusOf(status), head).$];

/** Whether a key whose read the store refused is absent (law refused_read_absent_exact). */
export const confirmRefusedRead = (listing: RefusedListing): RefusedRead =>
  CONFIRMS[bend.confirm_absent(LISTINGS[listing]).$];

/** A refused page of a listing: the end only when it is the first (law refused_page_exact). */
export const refusedPage = (later: boolean): "empty" | "fault" =>
  bend.refused_page(later).$ === "EmptyPage" ? "empty" : "fault";

/** A copy or move refused part-way (law copy_refused_exact). */
export const copyRefusal = (replaces: boolean): "name-refused" | "name-refused-replaced" =>
  bend.copy_refused(replaces).$ === "RReplacedGone" ? "name-refused-replaced" : "name-refused";
