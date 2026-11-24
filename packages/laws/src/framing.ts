import bend, { type BendForm, type BendStatusKind } from "./compiled/framing.mjs";

/** The form of a request target (RFC 9112 §3.2); `invalid` names no resource. */
export type TargetForm = "origin" | "absolute" | "asterisk" | "invalid";

/** Where a request's URL takes its path and host from. */
export interface UrlPlan {
  readonly path: "target" | "absolute" | "slash";
  readonly host: "header" | "none";
}

const kindOf = (status: number): BendStatusKind =>
  status < 200
    ? { $: "KInformational" }
    : status === 204
      ? { $: "KNoContent" }
      : status === 304
        ? { $: "KNotModified" }
        : { $: "KOther" };

const FORMS: Record<TargetForm, BendForm> = {
  origin: { $: "FOrigin" },
  absolute: { $: "FAbsolute" },
  asterisk: { $: "FAsterisk" },
  invalid: { $: "FInvalid" },
};
const PATHS = { PTarget: "target", PAbsolute: "absolute", PSlash: "slash" } as const;
const HOSTS = { HHeader: "header", HNone: "none" } as const;

/** Whether to send the Content-Length a body measured (law measured_length_exact). */
export const sendsMeasuredLength = (given: boolean, ended: boolean, status: number): boolean =>
  bend.measured_length(given, ended, kindOf(status));

/** Whether a WebDAV body goes through a fixed-length stream (law fixed_length_exact). */
export const fixesLength = (facts: {
  readonly hasBody: boolean;
  readonly hasHeader: boolean;
  readonly webdav: boolean;
  readonly encoded: boolean;
  readonly numeric: boolean;
}): boolean =>
  bend.fixed_length(facts.hasBody, facts.hasHeader, facts.webdav, facts.encoded, facts.numeric);

/** Where a request's URL comes from (laws url_host_from_header, url_path_exact). */
export const planUrl = (form: TargetForm, hostOk: boolean): UrlPlan => {
  const url = bend.url_of(FORMS[form], hostOk);
  return { path: PATHS[url.path.$], host: HOSTS[url.host.$] };
};
