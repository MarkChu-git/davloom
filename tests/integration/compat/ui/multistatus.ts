// A WebDAV listing as the server answers a PROPFIND with Depth 1 (RFC 4918 §9.1), for specs that
// answer the Dashboard's listing themselves: the screenshots, whose listings must not change from
// run to run, and the large listings, which would take thousands of uploads to make for real.

export interface ListedEntry {
  readonly name: string;
  /** A folder when absent. */
  readonly bytes?: number;
  readonly modified: Date;
  readonly type?: string;
}

const escapeXml = (text: string) =>
  text.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");

/** The /dav address of a folder or file, each name encoded as the server writes it. */
const hrefOf = (names: readonly string[], isFolder: boolean) =>
  names.length === 0
    ? "/dav/"
    : `/dav/${names.map((name) => encodeURIComponent(name)).join("/")}${isFolder ? "/" : ""}`;

const responseOf = (names: readonly string[], entry: ListedEntry | undefined) => {
  const isFolder = entry?.bytes === undefined;
  const props = [
    `<D:resourcetype>${isFolder ? "<D:collection/>" : ""}</D:resourcetype>`,
    entry === undefined
      ? ""
      : `<D:getlastmodified>${entry.modified.toUTCString()}</D:getlastmodified>`,
    isFolder ? "" : `<D:getcontentlength>${entry?.bytes ?? 0}</D:getcontentlength>`,
    isFolder
      ? ""
      : `<D:getcontenttype>${escapeXml(entry?.type ?? "application/octet-stream")}</D:getcontenttype>`,
    "<D:lockdiscovery/>",
  ].join("");
  return `<D:response><D:href>${escapeXml(hrefOf(names, isFolder))}</D:href><D:propstat><D:prop>${props}</D:prop><D:status>HTTP/1.1 200 OK</D:status></D:propstat></D:response>`;
};

/** The multistatus of the folder at `folder`, such as ["files", "Drafts"], holding `entries`. */
export const multistatus = (folder: readonly string[], entries: readonly ListedEntry[]): string =>
  `<?xml version="1.0" encoding="utf-8"?><D:multistatus xmlns:D="DAV:">${[
    responseOf(folder, undefined),
    ...entries.map((entry) => responseOf([...folder, entry.name], entry)),
  ].join("")}</D:multistatus>`;

/** The names of a /dav path such as /dav/files/Drafts/, decoded. */
export const davNames = (url: string): string[] =>
  new URL(url).pathname
    .split("/")
    .filter((name) => name !== "")
    .slice(1)
    .map((name) => decodeURIComponent(name));
