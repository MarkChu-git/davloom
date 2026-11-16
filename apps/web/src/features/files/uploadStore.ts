import { Store, useStore } from "@tanstack/react-store";
import { SAMPLE_NOW } from "../sample-data/data";
import { sampleId } from "../sample-data/id";
import { putFile } from "./fileStore";

export type UploadState = "uploading" | "done" | "failed";

export interface Upload {
  id: string;
  name: string;
  path: string;
  sizeBytes: number;
  sentBytes: number;
  state: UploadState;
  problem?: string;
}

/** Cloudflare Free accepts request bodies up to 100 MB, so a larger file cannot go in one PUT. */
export const UPLOAD_LIMIT_BYTES = 100_000_000;

/** Why a file of this size cannot be uploaded in one request, or undefined when it can. */
export const uploadProblem = (sizeBytes: number): string | undefined =>
  sizeBytes > UPLOAD_LIMIT_BYTES
    ? "Over the 100 MB limit for one request on Cloudflare Free."
    : undefined;

const TICK_MS = 120;
const TEXT_PREVIEW_LIMIT = 100_000;
const TEXT_NAME = /\.(md|txt|log|csv|json)$/i;
/** Files up to this size are read whole before they upload, the way a real upload reads them. */
const READ_WHOLE_LIMIT = 1_000_000;

interface Batch {
  ids: readonly string[];
  /** Each upload's final state. Clearing finished uploads from the list leaves the batch alone. */
  outcomes: Map<string, Upload>;
  onSettled: (uploads: Upload[]) => void;
}

const uploadStore = new Store<Upload[]>([]);
const texts = new Map<string, string>();
/** Uploads whose file could be read, so their bytes can start to go. */
const readable = new Set<string>();
const batches = new Set<Batch>();
let timer: ReturnType<typeof setInterval> | undefined;

export const useUploads = (): Upload[] => useStore(uploadStore, (uploads) => uploads);

const settle = (upload: Upload): void => {
  for (const batch of batches) {
    if (batch.ids.includes(upload.id)) {
      batch.outcomes.set(upload.id, upload);
      if (batch.outcomes.size === batch.ids.length) {
        batches.delete(batch);
        batch.onSettled(batch.ids.flatMap((id) => batch.outcomes.get(id) ?? []));
      }
    }
  }
};

const replace = (next: Upload): void => {
  uploadStore.setState((uploads) =>
    uploads.map((upload) => (upload.id === next.id ? next : upload)),
  );
};

/** Advances every readable upload as if bytes were sent, since the prototype has no server. */
const tick = (): void => {
  const running = uploadStore.state.filter(
    (upload) => upload.state === "uploading" && readable.has(upload.id),
  );
  for (const upload of running) {
    const step = Math.max(upload.sizeBytes / 15, 40_000);
    const sentBytes = Math.min(upload.sizeBytes, upload.sentBytes + step);
    if (sentBytes < upload.sizeBytes) {
      replace({ ...upload, sentBytes });
      continue;
    }
    // The last byte arrives: the server stores the file, or answers why it cannot.
    const problem = putFile(upload.path, {
      name: upload.name,
      kind: "file",
      sizeBytes: upload.sizeBytes,
      modifiedAt: SAMPLE_NOW.toISOString(),
      text: texts.get(upload.id),
    });
    const settled: Upload =
      problem === undefined
        ? { ...upload, sentBytes, state: "done" }
        : { ...upload, state: "failed", problem };
    replace(settled);
    settle(settled);
  }
  if (!uploadStore.state.some((upload) => upload.state === "uploading")) {
    clearInterval(timer);
    timer = undefined;
  }
};

/**
 * Reads the file before its bytes go, and keeps the text of a small text file for its preview.
 * A folder dropped onto the page arrives as a File that cannot be read, so it fails here.
 */
const read = async (upload: Upload, file: File): Promise<void> => {
  try {
    if (file.size <= TEXT_PREVIEW_LIMIT && TEXT_NAME.test(file.name)) {
      texts.set(upload.id, await file.text());
    } else {
      await (file.size <= READ_WHOLE_LIMIT ? file : file.slice(0, 1)).arrayBuffer();
    }
    readable.add(upload.id);
  } catch {
    const failed: Upload = {
      ...upload,
      state: "failed",
      problem: "This is a folder or a file that cannot be read. Upload the files inside a folder.",
    };
    replace(failed);
    settle(failed);
  }
};

export const startUploads = (
  path: string,
  files: readonly File[],
  onSettled: (uploads: Upload[]) => void,
): void => {
  const batch = files.map((file): [Upload, File] => {
    const problem = uploadProblem(file.size);
    return [
      {
        id: sampleId(),
        name: file.name,
        path,
        sizeBytes: file.size,
        sentBytes: 0,
        state: problem === undefined ? "uploading" : "failed",
        problem,
      },
      file,
    ];
  });
  uploadStore.setState((uploads) => [...batch.map(([upload]) => upload), ...uploads]);
  batches.add({ ids: batch.map(([upload]) => upload.id), outcomes: new Map(), onSettled });
  for (const [upload, file] of batch) {
    if (upload.state === "failed") {
      settle(upload);
    } else {
      void read(upload, file);
    }
  }
  timer ??= setInterval(tick, TICK_MS);
};

export const clearFinished = (): void => {
  uploadStore.setState((uploads) => uploads.filter((upload) => upload.state === "uploading"));
};
