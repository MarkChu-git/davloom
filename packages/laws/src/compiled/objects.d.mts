import type { Ctor } from "../bend";

export type BendCode =
  | Ctor<"CNotStore">
  | Ctor<"CNoSuchKey">
  | Ctor<"CTooLarge">
  | Ctor<"CRefusedKey">
  | Ctor<"CNoCode">
  | Ctor<"CUnwritable">
  | Ctor<"CPrecondition">
  | Ctor<"CFull">
  | Ctor<"COther">;
export type BendStatus = Ctor<"S400"> | Ctor<"S412"> | Ctor<"S507"> | Ctor<"SOther">;
export type BendFailure =
  | Ctor<"ONotFound">
  | Ctor<"OTooLarge">
  | Ctor<"ONameRefused">
  | Ctor<"OExists">
  | Ctor<"OFull">
  | Ctor<"OUnavailable">;
export type BendListing = Ctor<"LShowsKey"> | Ctor<"LNotKey"> | Ctor<"LRefused"> | Ctor<"LFailed">;
export type BendConfirm = Ctor<"Absent"> | Ctor<"Fault"> | Ctor<"ListingFailure">;
export type BendPage = Ctor<"EmptyPage"> | Ctor<"PageFault">;
export type BendRefusal = Ctor<"RNothingChanged"> | Ctor<"RReplacedGone">;

declare const module: {
  classify(code: BendCode, status: BendStatus, head: boolean): BendFailure;
  confirm_absent(listing: BendListing): BendConfirm;
  refused_page(later: boolean): BendPage;
  copy_refused(replaces: boolean): BendRefusal;
};
export default module;
