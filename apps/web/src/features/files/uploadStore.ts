import { Store, useStore } from "@tanstack/react-store";
import { davProblem, uploadFile } from "../api/dav";
import { joinPath, splitPath } from "./paths";

export type UploadState = "uploading" | "done" | "failed";

export interface Upload {
  id: string;
  name: string;
  /** The folder the file goes to, such as "/files/Drafts". */
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
    ? "Over the 100 MB limit for one request on Cloudflare Free."
    : undefined;

/** Why a file dropped into `names` cannot keep its name, or undefined when it can. */
export const uploadNameProblem = (name: string, folders: ReadonlySet<string>): string | undefined =>
  folders.has(name) ? `A folder named “${name}” is already here.` : undefined;

/**
 * A folder dropped onto the page arrives as a File that cannot be read. Reading its first byte
 * tells the two apart before any request goes.
 */
const isReadable = async (file: File): Promise<boolean> => {
  try {
    await file.slice(0, 1).arrayBuffer();
    return true;
  } catch {
    return false;
  }
};

let nextId = 0;
const uploadStore = new Store<Upload[]>([]);

export const useUploads = (): Upload[] => useStore(uploadStore, (uploads) => uploads);

const replace = (next: Upload): void => {
  uploadStore.setState((uploads) =>
    uploads.map((upload) => (upload.id === next.id ? next : upload)),
  );
};

const current = (id: string): Upload | undefined =>
  uploadStore.state.find((upload) => upload.id === id);

/** Sends one file, keeping its row up to date, and returns how it ended. */
const send = async (upload: Upload, file: File): Promise<Upload> => {
  if (upload.state === "failed") {
    return upload;
  }
  if (!(await isReadable(file))) {
    const failed: Upload = {
      ...upload,
      state: "failed",
      problem: "This is a folder or a file that cannot be read. Upload the files inside a folder.",
    };
    replace(failed);
    return failed;
  }
  try {
    await uploadFile([...splitPath(upload.path), upload.name], file, (sentBytes) => {
      const row = current(upload.id);
      if (row !== undefined && row.state === "uploading") {
        replace({ ...row, sentBytes });
      }
    });
    const done: Upload = { ...upload, sentBytes: upload.sizeBytes, state: "done" };
    replace(done);
    return done;
  } catch (error) {
    const failed: Upload = { ...upload, state: "failed", problem: davProblem(error, upload.path) };
    replace(failed);
    return failed;
  }
};

/**
 * Uploads files to the folder at `path`, two at a time, and calls `onSettled` with every outcome
 * once the last one ends. `folders` names the folder's subfolders, which a file cannot replace.
 */
export const startUploads = (
  path: string,
  files: readonly File[],
  folders: ReadonlySet<string>,
  onSettled: (uploads: Upload[]) => void,
): void => {
  const batch = files.map((file): [Upload, File] => {
    const problem = uploadProblem(file.size) ?? uploadNameProblem(file.name, folders);
    nextId += 1;
    return [
      {
        id: `upload-${nextId}`,
        name: file.name,
        path: joinPath(splitPath(path)),
        sizeBytes: file.size,
        sentBytes: 0,
        state: problem === undefined ? "uploading" : "failed",
        problem,
      },
      file,
    ];
  });
  uploadStore.setState((uploads) => [...batch.map(([upload]) => upload), ...uploads]);
  const queue = [...batch];
  const outcomes = new Map<string, Upload>();
  const worker = async (): Promise<void> => {
    for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
      const [upload, file] = next;
      outcomes.set(upload.id, await send(upload, file));
    }
  };
  void Promise.all([worker(), worker()]).then(() =>
    onSettled(batch.flatMap(([upload]) => outcomes.get(upload.id) ?? [])),
  );
};

export const clearFinished = (): void => {
  uploadStore.setState((uploads) => uploads.filter((upload) => upload.state === "uploading"));
};
