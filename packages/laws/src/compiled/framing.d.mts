import type { Ctor } from "../bend";

export type BendStatusKind =
  | Ctor<"KInformational">
  | Ctor<"KNoContent">
  | Ctor<"KNotModified">
  | Ctor<"KOther">;
export type BendForm = Ctor<"FOrigin"> | Ctor<"FAbsolute"> | Ctor<"FAsterisk"> | Ctor<"FInvalid">;
export type BendUrl = Ctor<
  "Url",
  {
    path: Ctor<"PTarget"> | Ctor<"PAbsolute"> | Ctor<"PSlash">;
    host: Ctor<"HHeader"> | Ctor<"HNone">;
  }
>;

declare const module: {
  measured_length(given: boolean, ended: boolean, kind: BendStatusKind): boolean;
  fixed_length(
    hasBody: boolean,
    hasHeader: boolean,
    webdav: boolean,
    encoded: boolean,
    numeric: boolean,
  ): boolean;
  url_of(form: BendForm, hostOk: boolean): BendUrl;
};
export default module;
