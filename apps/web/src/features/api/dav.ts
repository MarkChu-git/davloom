import { joinPath } from "../files/paths";
import { VERIFICATION_REQUIRED, withStepUp } from "./stepUp";

// The Dashboard's WebDAV client. It reaches /dav with the session cookie, which the server takes
// only from a request that carries the Dashboard's header: a cross-site form cannot send one.

/** The WebDAV address of this instance, where clients connect. */
export const webdavAddress = (): string => `${location.origin}/dav/`;

export const DASHBOARD_HEADERS = { "x-davloom-dashboard": "1" } as const;

export type EntryKind = "folder" | "file";

export interface Entry {
  name: string;
  kind: EntryKind;
  sizeBytes: number;
  /** ISO time, or "" when the server sent none. */
  modifiedAt: string;
  contentType: string;
}

/** A WebDAV request the server refused, with its status, and the API's code when it sent one. */
export class DavError extends Error {
  readonly status: number;
  readonly code: string | undefined;

  constructor(status: number, code?: string) {
    super(`WebDAV answered ${status}`);
    this.name = "DavError";
    this.status = status;
    this.code = code;
  }
}

/** The code of a JSON refusal such as `{"error":{"code":"verification_required"}}`. */
const refusalCode = async (response: Response): Promise<string | undefined> => {
  if (!(response.headers.get("content-type") ?? "").includes("json")) {
    return undefined;
  }
  try {
    const body: unknown = await response.json();
    const error: unknown =
      typeof body === "object" && body !== null ? Reflect.get(body, "error") : undefined;
    const code: unknown =
      typeof error === "object" && error !== null ? Reflect.get(error, "code") : undefined;
    return typeof code === "string" ? code : undefined;
  } catch {
    return undefined;
  }
};

export const isDavError = (error: unknown): error is DavError => error instanceof DavError;

/** The address of a path under /dav, each name encoded, a folder's with a trailing slash. */
export const davHref = (parts: readonly string[], isFolder = false): string => {
  const encoded = parts.map((part) => encodeURIComponent(part)).join("/");
  if (encoded === "") {
    return "/dav/";
  }
  return `/dav/${encoded}${isFolder ? "/" : ""}`;
};

/** One `<D:response>` of a multistatus, read into plain values. */
export interface DavResponse {
  href: string;
  isCollection: boolean;
  contentLength: string | null;
  lastModified: string | null;
  contentType: string | null;
}

/** The names of a path in an href, which may be a full URL or a path, each decoded. */
export const hrefParts = (href: string): string[] | undefined => {
  let pathname: string;
  try {
    pathname = new URL(href, "http://davloom.invalid").pathname;
  } catch {
    return undefined;
  }
  const names = pathname.split("/").filter((name) => name !== "");
  if (names[0] !== "dav") {
    return undefined;
  }
  try {
    return names.slice(1).map((name) => decodeURIComponent(name));
  } catch {
    return undefined;
  }
};

const isoOf = (httpDate: string | null): string => {
  if (httpDate === null) {
    return "";
  }
  const time = Date.parse(httpDate);
  return Number.isNaN(time) ? "" : new Date(time).toISOString();
};

/** The entries directly inside `folder`, from the responses of a PROPFIND with Depth 1. */
export const entriesOf = (
  responses: readonly DavResponse[],
  folder: readonly string[],
): Entry[] => {
  const entries: Entry[] = [];
  for (const response of responses) {
    const parts = hrefParts(response.href);
    if (
      parts === undefined ||
      parts.length !== folder.length + 1 ||
      folder.some((name, index) => parts[index] !== name)
    ) {
      // The folder itself, or an answer this listing did not ask for.
      continue;
    }
    const name = parts.at(-1) ?? "";
    const size = Number(response.contentLength ?? "0");
    entries.push({
      name,
      kind: response.isCollection ? "folder" : "file",
      sizeBytes: response.isCollection || !Number.isFinite(size) ? 0 : size,
      modifiedAt: isoOf(response.lastModified),
      contentType: response.contentType ?? "",
    });
  }
  return entries;
};

const DAV_NS = "DAV:";

const firstText = (scope: Element, name: string): string | null => {
  const found = scope.getElementsByTagNameNS(DAV_NS, name)[0];
  return found === undefined ? null : (found.textContent ?? "").trim();
};

/** Reads a multistatus body with the browser's XML parser. Only the 200 propstat counts. */
export const parseMultistatus = (xml: string): DavResponse[] => {
  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) {
    throw new DavError(502);
  }
  return [...document.getElementsByTagNameNS(DAV_NS, "response")].flatMap((response) => {
    const href = firstText(response, "href");
    if (href === null) {
      return [];
    }
    const found = [...response.getElementsByTagNameNS(DAV_NS, "propstat")].find((propstat) =>
      /\s200\s/.test(` ${firstText(propstat, "status") ?? ""} `),
    );
    if (found === undefined) {
      return [
        { href, isCollection: false, contentLength: null, lastModified: null, contentType: null },
      ];
    }
    return [
      {
        href,
        isCollection: found.getElementsByTagNameNS(DAV_NS, "collection").length > 0,
        contentLength: firstText(found, "getcontentlength"),
        lastModified: firstText(found, "getlastmodified"),
        contentType: firstText(found, "getcontenttype"),
      },
    ];
  });
};

const PROPFIND_BODY = `<?xml version="1.0" encoding="utf-8"?>
<D:propfind xmlns:D="DAV:"><D:prop><D:resourcetype/><D:getcontentlength/><D:getlastmodified/><D:getcontenttype/></D:prop></D:propfind>`;

const send = async (
  method: string,
  parts: readonly string[],
  {
    isFolder = false,
    headers = {},
    body,
  }: {
    isFolder?: boolean;
    headers?: Record<string, string>;
    body?: string;
  } = {},
): Promise<Response> =>
  // Deleting, or replacing at a destination, asks for step-up verification (stepUp.ts).
  withStepUp(async () => {
    let response: Response;
    try {
      response = await fetch(davHref(parts, isFolder), {
        method,
        credentials: "same-origin",
        headers: { ...DASHBOARD_HEADERS, ...headers },
        body,
      });
    } catch {
      throw new DavError(0);
    }
    if (!response.ok) {
      throw new DavError(
        response.status,
        response.status === 403 ? await refusalCode(response) : undefined,
      );
    }
    return response;
  });

/** The entries of the folder at `parts`, the first part naming its Mount. */
export const listFolder = async (parts: readonly string[]): Promise<Entry[]> => {
  const response = await send("PROPFIND", parts, {
    isFolder: true,
    headers: { depth: "1", "content-type": "application/xml; charset=utf-8" },
    body: PROPFIND_BODY,
  });
  if (response.status !== 207) {
    throw new DavError(response.status);
  }
  return entriesOf(parseMultistatus(await response.text()), parts);
};

export const createFolder = async (parts: readonly string[]): Promise<void> => {
  await send("MKCOL", parts, { isFolder: true });
};

export const removeEntry = async (parts: readonly string[], kind: EntryKind): Promise<void> => {
  await send("DELETE", parts, { isFolder: kind === "folder" });
};

export type Transfer = "move" | "copy";

/**
 * Moves or copies an entry to `to`, refusing to replace anything there (`Overwrite: F`), as
 * Finder and the other clients ask before they replace.
 */
export const transferEntry = async (
  transfer: Transfer,
  from: readonly string[],
  to: readonly string[],
  kind: EntryKind,
): Promise<void> => {
  await send(transfer === "move" ? "MOVE" : "COPY", from, {
    isFolder: kind === "folder",
    headers: {
      // A path alone: the server resolves it against the request's own URL, which also holds
      // behind the dev server's proxy, where the Worker sees another host than the page.
      destination: davHref(to, kind === "folder"),
      overwrite: "F",
    },
  });
};

/** Reads a file whole, for a text preview. */
export const readText = async (parts: readonly string[]): Promise<string> =>
  (await send("GET", parts)).text();

/** Saves a file through the browser's downloads, under its own name. */
export const downloadFile = async (parts: readonly string[]): Promise<void> => {
  const blob = await (await send("GET", parts)).blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = parts.at(-1) ?? "download";
  link.style.display = "none";
  document.body.append(link);
  link.click();
  link.remove();
  // The browser has taken the address once the click returns; a later turn can let it go.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
};

/**
 * Uploads a file with PUT. XMLHttpRequest streams the File from disk as fetch does, and reports
 * how much of it has gone, which fetch cannot.
 */
export const uploadFile = (
  parts: readonly string[],
  file: Blob,
  onProgress: (sentBytes: number) => void,
): Promise<void> =>
  new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("PUT", davHref(parts));
    for (const [name, value] of Object.entries(DASHBOARD_HEADERS)) {
      request.setRequestHeader(name, value);
    }
    if (file.type !== "") {
      request.setRequestHeader("content-type", file.type);
    }
    request.upload.addEventListener("progress", (event) => onProgress(event.loaded));
    request.addEventListener("load", () => {
      if (request.status >= 200 && request.status < 300) {
        onProgress(file.size);
        resolve();
      } else {
        reject(new DavError(request.status));
      }
    });
    request.addEventListener("error", () => reject(new DavError(0)));
    request.addEventListener("abort", () => reject(new DavError(0)));
    request.send(file);
  });

/** What a refused WebDAV request means, in a sentence. */
export const davProblem = (error: unknown, path: string = joinPath([])): string => {
  if (!isDavError(error)) {
    return "Something went wrong. Try again.";
  }
  switch (error.status) {
    case 0:
      return "Davloom could not be reached. Check the connection and try again.";
    case 401:
      return "Your session has ended. Sign in again.";
    case 403:
      return error.code === VERIFICATION_REQUIRED
        ? "Verify it is you to do this."
        : "This session may not change files here.";
    case 404:
      return `${path} is no longer there.`;
    case 405:
    case 412:
      return "Something with this name is already there.";
    case 409:
      return "The destination folder does not exist.";
    case 413:
      return "The file is larger than one request may carry.";
    case 423:
      return "Another client has locked it.";
    case 501:
      return "This server does not serve files yet.";
    case 502:
      return "The server's answer could not be read.";
    case 503:
      return "The storage backend is not answering.";
    case 507:
      return "The storage backend is full.";
    default:
      return `The server refused the request (${error.status}).`;
  }
};
