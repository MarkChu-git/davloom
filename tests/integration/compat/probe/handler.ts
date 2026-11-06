import type { WebDavHandler } from "@davloom/webdav";
import { echoHandler } from "./echo-handler";
import { readUpload, startDownload } from "./stream-handler";

const UPLOAD_PATH = /^\/dav\/__stream\/upload\/([^/]+)$/;
const DOWNLOAD_PATH = /^\/dav\/__stream\/download\/([^/]+)$/;

/** Stands in for the protocol engine: reserved paths stream, and everything else is echoed. */
export const probeHandler: WebDavHandler = (request) => {
  const path = new URL(request.url).pathname;
  const uploadId = path.match(UPLOAD_PATH)?.[1];
  if (uploadId) {
    return readUpload(request, uploadId);
  }
  const downloadId = path.match(DOWNLOAD_PATH)?.[1];
  if (downloadId) {
    return startDownload(request, downloadId);
  }
  return echoHandler(request);
};
