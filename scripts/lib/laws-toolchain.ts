import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { open } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { PLATFORMS, type Platform } from "./tools";

// Bend and the Lean release that builds Bend's `--verdict` kernel, at the versions and archive
// digests that packages/laws/toolchain.json pins (Decision 10 of add-phase-1-core). Setup downloads
// each archive that the tool cache of scripts/lib/tools.ts lacks and checks every one against its
// pin before it unpacks any, so an archive that differs installs nothing. It then builds the kernel
// with the cached Lean, the way `bend` builds its own, and `bend` runs that kernel when `$BENDTT`
// names it. A cached release is trusted like Bun's own install cache; deleting its directory makes
// the next run download and check it again.

export const TOOLCHAIN_FILE = "packages/laws/toolchain.json";

export interface Archive {
  readonly url: string;
  readonly sha256: string;
}

export interface Release {
  readonly version: string;
  readonly archives: Readonly<Record<Platform, Archive>>;
}

export interface Toolchain {
  readonly bend: Release;
  readonly lean: Release;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const invalid = (where: string, problem: string): Error =>
  new Error(`${TOOLCHAIN_FILE}: ${where} ${problem}`);

// Bend publishes .tar.gz archives and Lean .tar.zst ones.
const FORMATS = [".tar.gz", ".tar.zst"];

const parseArchive = (value: unknown, where: string): Archive => {
  if (!isRecord(value)) {
    throw invalid(where, "is missing or not an object");
  }
  const { url, sha256 } = value;
  if (
    typeof url !== "string" ||
    !url.startsWith("https://") ||
    !FORMATS.some((format) => url.endsWith(format))
  ) {
    throw invalid(`${where}.url`, "is not an https URL of a .tar.gz or .tar.zst archive");
  }
  if (typeof sha256 !== "string" || !/^[0-9a-f]{64}$/.test(sha256)) {
    throw invalid(`${where}.sha256`, "is not 64 lowercase hex digits");
  }
  return { url, sha256 };
};

const parseRelease = (value: unknown, name: string): Release => {
  if (!isRecord(value)) {
    throw invalid(name, "is missing or not an object");
  }
  const { version, archives } = value;
  if (typeof version !== "string" || !/^\d+\.\d+\.\d+$/.test(version)) {
    throw invalid(`${name}.version`, "is not a version like 1.2.3");
  }
  if (!isRecord(archives)) {
    throw invalid(`${name}.archives`, "is missing or not an object");
  }
  const unknown = Object.keys(archives).filter(
    (key) => !PLATFORMS.some((platform) => platform === key),
  );
  if (unknown.length > 0) {
    throw invalid(
      `${name}.archives`,
      `names ${unknown.join(", ")}, not one of ${PLATFORMS.join(", ")}`,
    );
  }
  const archive = (platform: Platform): Archive =>
    parseArchive(archives[platform], `${name}.archives.${platform}`);
  return {
    version,
    archives: {
      "darwin-arm64": archive("darwin-arm64"),
      "darwin-x64": archive("darwin-x64"),
      "linux-arm64": archive("linux-arm64"),
      "linux-x64": archive("linux-x64"),
    },
  };
};

/** The pins in the parsed `packages/laws/toolchain.json`, or an error that names the bad field. */
export const parseToolchain = (value: unknown): Toolchain => {
  if (!isRecord(value)) {
    throw invalid("the file", "does not hold an object");
  }
  return { bend: parseRelease(value["bend"], "bend"), lean: parseRelease(value["lean"], "lean") };
};

export const readToolchain = async (root: string): Promise<Toolchain> =>
  parseToolchain(await Bun.file(join(root, TOOLCHAIN_FILE)).json());

export interface ToolchainPaths {
  /** The `bend` executable. */
  readonly bend: string;
  /** Lean's directory, which holds `bin/lean` and `bin/leanc`. */
  readonly lean: string;
  /** The `--verdict` kernel, which `bend` runs when `$BENDTT` names it. */
  readonly kernel: string;
}

export const toolchainPaths = (
  toolchain: Toolchain,
  cacheDir: string,
  platform: Platform,
): ToolchainPaths => ({
  bend: join(cacheDir, "bend", toolchain.bend.version, platform, "bin", "bend"),
  lean: join(cacheDir, "lean", toolchain.lean.version, platform),
  kernel: join(
    cacheDir,
    "bendtt",
    `bend-${toolchain.bend.version}-lean-${toolchain.lean.version}`,
    platform,
    "bendtt",
  ),
});

export type FetchArchive = (
  url: string,
  init: { readonly signal: AbortSignal; readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>;

export interface SetupOptions {
  readonly cacheDir: string;
  readonly platform: Platform;
  readonly fetchArchive?: FetchArchive;
  /** Receives a line as each download, resumed download and kernel build starts. */
  readonly log?: (line: string) => void;
  /** How long a download may go without data before setup resumes it, 60 seconds unless set. */
  readonly stallMs?: number;
}

// A proxy can keep a download's connection open without sending anything, and fetch then waits
// forever: one stopped at 174 of 562 MB on 2026-11-20. Setup resumes such a download, one whose
// connection fails and one that a server error ends, with a Range request, which GitHub's release
// downloads answer. It gives up once five attempts in a row add nothing to the file, so a proxy
// that drops the connection every so often slows a download without ending it. A refusal such as
// 404 ends setup at once.
const STALL_MS = 60_000;
const ATTEMPTS = 5;

class RefusedError extends Error {}

const mib = (bytes: number): string => `${(bytes / 2 ** 20).toFixed(1)} MiB`;

export interface SetupResult {
  readonly paths: ToolchainPaths;
  /** The URL of each archive this run downloaded. */
  readonly downloaded: readonly string[];
  readonly builtKernel: boolean;
}

interface Install {
  readonly archive: Archive;
  readonly target: string;
  /** Files that the unpacked release holds, relative to its directory. */
  readonly files: readonly string[];
}

const installed = (install: Install): boolean =>
  install.files.every((file) => existsSync(join(install.target, file)));

/**
 * Fails, naming what to delete, when a directory where a missing release belongs lacks one of its
 * files, or when something other than a file holds the kernel's path. Setup could never move the
 * release there, and would take that path for a built kernel.
 */
const refuseInTheWay = (missing: readonly Install[], kernel: string): void => {
  for (const { target, files } of missing) {
    // A release that another run has just moved into place lacks nothing.
    const absent = files.filter((file) => !existsSync(join(target, file)));
    if (absent.length > 0 && existsSync(target)) {
      throw new Error(
        `${target} holds no ${absent.join(" and no ")}; delete it and run setup again`,
      );
    }
  }
  if (statSync(kernel, { throwIfNoEntry: false })?.isFile() === false) {
    throw new Error(`${kernel} is not a file; delete it and run setup again`);
  }
};

/** Writes the bytes of `archive` to `file`, resuming after a stall or a failed connection. */
const fetchInto = async (
  archive: Archive,
  file: string,
  { fetchArchive, stallMs, log }: Required<Pick<SetupOptions, "fetchArchive" | "stallMs" | "log">>,
): Promise<void> => {
  let size = 0;
  // Attempts in a row that added nothing to the file.
  let stuck = 0;
  for (;;) {
    const start = size;
    const controller = new AbortController();
    const handle = await open(file, size > 0 ? "a" : "w");
    // The clock starts once the file is open, so a slow disk does not count as a stall.
    let timer = setTimeout(() => controller.abort(), stallMs);
    try {
      const response = await fetchArchive(archive.url, {
        signal: controller.signal,
        headers: size > 0 ? { range: `bytes=${size}-` } : {},
      });
      if (response.status === 416 && size > 0) {
        // A connection lost after the last byte leaves no range to resume, so the file may be
        // whole. The SHA-256 check decides.
        return;
      }
      if (!response.ok || response.body === null) {
        const message = `Downloading ${archive.url} failed with HTTP ${response.status}`;
        throw response.status >= 500 ? new Error(message) : new RefusedError(message);
      }
      const resumed =
        response.status === 206 &&
        response.headers.get("content-range")?.startsWith(`bytes ${size}-`) === true;
      if (!resumed && size > 0) {
        // The server sent the archive from its start instead of the range asked for.
        await handle.truncate(0);
        size = 0;
      }
      for await (const chunk of response.body) {
        clearTimeout(timer);
        timer = setTimeout(() => controller.abort(), stallMs);
        await handle.write(chunk);
        size += chunk.byteLength;
      }
      return;
    } catch (error) {
      if (error instanceof RefusedError) {
        throw error;
      }
      const why = controller.signal.aborted
        ? `received nothing for ${stallMs / 1000} s`
        : `failed: ${error instanceof Error ? error.message : String(error)}`;
      stuck = size > start ? 0 : stuck + 1;
      if (stuck === ATTEMPTS) {
        throw new Error(
          `Downloading ${archive.url} got no further in ${ATTEMPTS} attempts in a row; the last attempt ${why} after ${mib(size)}, so nothing was installed`,
          { cause: error },
        );
      }
      log(`The download ${why} after ${mib(size)}; resuming it`);
    } finally {
      clearTimeout(timer);
      await handle.close();
    }
  }
};

/** Downloads `archive` into `dir` and returns the file, once its SHA-256 matches the pin. */
const download = async (
  archive: Archive,
  dir: string,
  options: Required<Pick<SetupOptions, "fetchArchive" | "stallMs" | "log">>,
): Promise<string> => {
  const file = join(dir, basename(new URL(archive.url).pathname));
  await fetchInto(archive, file, options);
  const hasher = new Bun.CryptoHasher("sha256");
  for await (const chunk of Bun.file(file).stream()) {
    hasher.update(chunk);
  }
  const actual = hasher.digest("hex");
  if (actual !== archive.sha256) {
    throw new Error(
      `The SHA-256 of ${archive.url} is ${actual}, but ${TOOLCHAIN_FILE} pins ${archive.sha256}, so nothing was installed`,
    );
  }
  return file;
};

/** Unpacks the release in `file` into the new directory `into`, without its top directory. */
const unpack = async (archive: Archive, file: string, into: string): Promise<void> => {
  mkdirSync(into);
  // The bsdtar 3.5 of macOS has no zstd support of its own and needs a `zstd` program, which macOS
  // does not ship, so Bun decompresses Lean's archive into tar's input.
  const zstd = archive.url.endsWith(".tar.zst");
  const tar = Bun.spawn(
    ["tar", zstd ? "-xf" : "-xzf", zstd ? "-" : file, "--strip-components", "1", "-C", into],
    {
      stdin: zstd
        ? // @ts-expect-error The CompressionFormat of lib.dom lacks "zstd", which Bun supports.
          Bun.file(file).stream().pipeThrough(new DecompressionStream("zstd"))
        : "ignore",
      stdout: "ignore",
      stderr: "pipe",
    },
  );
  const [code, stderr] = await Promise.all([tar.exited, new Response(tar.stderr).text()]);
  if (code !== 0) {
    throw new Error(`tar could not unpack ${archive.url}: ${stderr.trim()}`);
  }
};

/** Runs `command` in `cwd` and returns its output, or fails with the start of it. */
const run = (command: readonly string[], cwd: string): string => {
  const result = Bun.spawnSync([...command], { cwd, stdout: "pipe", stderr: "pipe" });
  const output = `${result.stdout.toString()}${result.stderr.toString()}`;
  if (result.exitCode !== 0) {
    throw new Error(
      `${command.join(" ")} exited with ${result.exitCode ?? result.signalCode}: ${output.trim().slice(0, 600)}`,
    );
  }
  return output;
};

/** The version that `lean --version` reports for the Lean in `dir`, run in `cwd`. */
const leanVersion = (dir: string, cwd: string): string | undefined =>
  run([join(dir, "bin", "lean"), "--version"], cwd).match(/^Lean \(version ([^,\s)]+)/m)?.[1];

/**
 * Builds the kernel in the new directory `dir` with the steps `bend` takes when it builds its own:
 * `lean --version` must report the pinned version, then `lean -c bendtt.c bendtt.lean` and
 * `leanc -O3 -DNDEBUG bendtt.c -o bendtt`. Moves it to `kernel` once it accepts an empty input.
 */
const buildKernel = (
  toolchain: Toolchain,
  paths: ToolchainPaths,
  bendDir: string,
  dir: string,
): void => {
  mkdirSync(dir);
  const lean = join(paths.lean, "bin", "lean");
  const version = leanVersion(paths.lean, dir);
  if (version !== toolchain.lean.version) {
    // Setup checks each Lean it installs, so this one reached the cache another way.
    throw new Error(
      `${lean} reports the version ${version ?? "(none)"}, but ${TOOLCHAIN_FILE} pins Lean ${toolchain.lean.version}; delete ${paths.lean} and run setup again`,
    );
  }
  copyFileSync(join(bendDir, "bend2", "bendtt.lean"), join(dir, "bendtt.lean"));
  run([lean, "-c", "bendtt.c", "bendtt.lean"], dir);
  run([join(paths.lean, "bin", "leanc"), "-O3", "-DNDEBUG", "bendtt.c", "-o", "bendtt"], dir);
  // An empty translation holds no def to refute, so a kernel that works accepts it.
  writeFileSync(join(dir, "empty.bendtt"), "");
  const verdict = run([join(dir, "bendtt"), "empty.bendtt"], dir).trim();
  if (verdict !== "ALL PROOFS CHECK") {
    throw new Error(
      `The kernel built from ${join(bendDir, "bend2", "bendtt.lean")} answered an empty input with "${verdict.slice(0, 300)}" instead of ALL PROOFS CHECK`,
    );
  }
  mkdirSync(dirname(paths.kernel), { recursive: true });
  renameSync(join(dir, "bendtt"), paths.kernel);
};

const alive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return error instanceof Error && "code" in error && error.code === "EPERM";
  }
};

/** Removes the staging directories that killed runs left in `cacheDir`, named after their PID. */
const removeStaleStaging = (cacheDir: string): void => {
  for (const name of readdirSync(cacheDir)) {
    const pid = /^\.laws-setup-(\d+)$/.exec(name)?.[1];
    if (pid !== undefined && !alive(Number(pid))) {
      rmSync(join(cacheDir, name), { recursive: true, force: true });
    }
  }
};

/**
 * Installs the pinned Bend and Lean in `cacheDir` where they are missing, and builds the kernel
 * where it is missing. A run that finds all three downloads nothing.
 */
export const setupToolchain = async (
  toolchain: Toolchain,
  {
    cacheDir,
    platform,
    fetchArchive = (url, init) => fetch(url, init),
    log = () => {},
    stallMs = STALL_MS,
  }: SetupOptions,
): Promise<SetupResult> => {
  const paths = toolchainPaths(toolchain, cacheDir, platform);
  const bend: Install = {
    archive: toolchain.bend.archives[platform],
    target: dirname(dirname(paths.bend)),
    files: [join("bin", "bend"), join("bend2", "bendtt.lean")],
  };
  const lean: Install = {
    archive: toolchain.lean.archives[platform],
    target: paths.lean,
    files: [join("bin", "lean"), join("bin", "leanc")],
  };
  if (existsSync(cacheDir)) {
    removeStaleStaging(cacheDir);
  }
  const missing = [bend, lean].filter((install) => !installed(install));
  refuseInTheWay(missing, paths.kernel);
  if (missing.length === 0 && existsSync(paths.kernel)) {
    return { paths, downloaded: [], builtKernel: false };
  }

  mkdirSync(cacheDir, { recursive: true });
  const staging = join(cacheDir, `.laws-setup-${process.pid}`);
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging);
  try {
    // Check every archive before unpacking any, so one that differs from its pin installs nothing.
    const downloads: { install: Install; file: string }[] = [];
    for (const install of missing) {
      log(`Downloading ${install.archive.url}`);
      const file = await download(install.archive, staging, { fetchArchive, stallMs, log });
      downloads.push({ install, file });
    }
    const unpacked: { install: Install; dir: string }[] = [];
    for (const [index, { install, file }] of downloads.entries()) {
      const dir = join(staging, `release-${index}`);
      await unpack(install.archive, file, dir);
      const absent = install.files.filter((path) => !existsSync(join(dir, path)));
      if (absent.length > 0) {
        throw new Error(`${install.archive.url} holds no ${absent.join(" and no ")}`);
      }
      if (install === lean) {
        // Checked before any release moves into place, so an archive of another Lean installs
        // nothing that a corrected pin would then have to replace.
        const version = leanVersion(dir, staging);
        if (version !== toolchain.lean.version) {
          throw new Error(
            `The Lean in ${install.archive.url} reports the version ${version ?? "(none)"}, but ${TOOLCHAIN_FILE} pins Lean ${toolchain.lean.version}, so nothing was installed`,
          );
        }
      }
      unpacked.push({ install, dir });
    }
    for (const { install, dir } of unpacked) {
      mkdirSync(dirname(install.target), { recursive: true });
      try {
        renameSync(dir, install.target);
      } catch (error) {
        // Another run installed the same release first, from an archive that passed the same check.
        if (!installed(install)) {
          throw error;
        }
      }
    }
    const builtKernel = !existsSync(paths.kernel);
    if (builtKernel) {
      log(`Building the --verdict kernel with Lean ${toolchain.lean.version}`);
      buildKernel(toolchain, paths, bend.target, join(staging, "kernel"));
    }
    return { paths, downloaded: missing.map((install) => install.archive.url), builtKernel };
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
};
