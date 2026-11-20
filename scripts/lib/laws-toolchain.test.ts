import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type Archive,
  type FetchArchive,
  type Toolchain,
  parseToolchain,
  readToolchain,
  setupToolchain,
  toolchainPaths,
} from "./laws-toolchain";
import { PLATFORMS, type Platform, sha256Of } from "./tools";

// Setup opens each archive file with this `open`, which a test can slow down, as a loaded runner
// does, or whose writes it can slow down or make fail, as a busy or full disk does.
const disk = vi.hoisted((): { openMs: number; writeMs: number; writeError?: Error } => ({
  openMs: 0,
  writeMs: 0,
}));

vi.mock(import("node:fs/promises"), async (importOriginal) => {
  const fs = await importOriginal();
  return {
    ...fs,
    open: async (...args: Parameters<typeof fs.open>) => {
      if (disk.openMs > 0) {
        await Bun.sleep(disk.openMs);
      }
      const handle = await fs.open(...args);
      const { writeError, writeMs } = disk;
      if (writeError !== undefined) {
        handle.write = () => Promise.reject(writeError);
      } else if (writeMs > 0) {
        const write = handle.write.bind(handle);
        // Defined, not assigned: only FileHandle's own write has every overload of its type.
        Object.defineProperty(handle, "write", {
          value: async (buffer: Uint8Array, offset?: number, length?: number) => {
            await Bun.sleep(writeMs);
            return write(buffer, offset, length);
          },
        });
      }
      return handle;
    },
  };
});

const root = fileURLToPath(new URL("../..", import.meta.url));

const PLATFORM: Platform = "darwin-arm64";

// A .tar.gz, or a .tar.zst when `zstd` is set, whose files sit under the directory `top`, as in the
// real releases. tar keeps each file's mode, so the fake tools stay executable.
const archiveOf = (
  top: string,
  files: Record<string, string>,
  zstd = false,
): Uint8Array<ArrayBuffer> => {
  const dir = mkdtempSync(join(tmpdir(), "laws-archive-"));
  try {
    for (const [path, text] of Object.entries(files)) {
      const file = join(dir, top, path);
      mkdirSync(dirname(file), { recursive: true });
      writeFileSync(file, text, { mode: path.startsWith("bin/") ? 0o755 : 0o644 });
    }
    const out = join(dir, "out");
    // COPYFILE_DISABLE keeps the bsdtar of macOS from adding AppleDouble files.
    const tar = Bun.spawnSync(["tar", zstd ? "-cf" : "-czf", out, "-C", dir, top], {
      env: { ...process.env, COPYFILE_DISABLE: "1" },
      stderr: "pipe",
    });
    expect(tar.stderr.toString()).toBe("");
    const bytes = new Uint8Array(readFileSync(out));
    return zstd ? new Uint8Array(Bun.zstdCompressSync(bytes)) : bytes;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

// Stand-ins for Lean's tools: `lean -c` writes the C file and `leanc` writes a kernel that accepts
// everything, so the steps run as they do with the real Lean, in seconds.
const fakeLean = (version: string): Record<string, string> => ({
  "bin/lean": [
    "#!/bin/sh",
    `if [ "$1" = --version ]; then echo "Lean (version ${version}, arm64-apple-darwin, Release)"; exit 0; fi`,
    'if [ "$1" = -c ]; then cp "$3" "$2"; exit 0; fi',
    "exit 1",
    "",
  ].join("\n"),
  "bin/leanc": [
    "#!/bin/sh",
    '[ "$1 $2 $3 $4" = "-O3 -DNDEBUG bendtt.c -o" ] || exit 1',
    `printf '#!/bin/sh\\necho "ALL PROOFS CHECK"\\n' > "$5"`,
    'chmod +x "$5"',
    "",
  ].join("\n"),
  "lib/lean/Init.olean": "fake",
});

const BEND_FILES = {
  "bin/bend": "#!/bin/sh\necho bend\n",
  "bend2/bendtt.lean": "-- the kernel source\n",
  "bend2/base.bend": "# Base\n",
};

const BEND_URL = "https://example.test/bend/v2.0.40/bend-2.0.40-darwin-arm64.tar.gz";
const LEAN_URL = "https://example.test/lean/v4.34.0/lean-4.34.0-darwin_aarch64.tar.zst";

const bendArchive = archiveOf("bend", BEND_FILES);
const leanArchive = archiveOf("lean-4.34.0-darwin_aarch64", fakeLean("4.34.0"), true);

const everyPlatform = (archive: Archive): Record<Platform, Archive> => ({
  "darwin-arm64": archive,
  "darwin-x64": archive,
  "linux-arm64": archive,
  "linux-x64": archive,
});

const toolchainOf = (bend: Uint8Array, lean: Uint8Array): Toolchain => ({
  bend: { version: "2.0.40", archives: everyPlatform({ url: BEND_URL, sha256: sha256Of(bend) }) },
  lean: { version: "4.34.0", archives: everyPlatform({ url: LEAN_URL, sha256: sha256Of(lean) }) },
});

const TOOLCHAIN = toolchainOf(bendArchive, leanArchive);

// Serves `files` by URL and records each request.
const server = (files: Readonly<Record<string, Uint8Array<ArrayBuffer>>>) => {
  const requests: string[] = [];
  const fetchArchive = (url: string): Promise<Response> => {
    requests.push(url);
    const bytes = files[url];
    return Promise.resolve(
      bytes === undefined ? new Response("Not Found", { status: 404 }) : new Response(bytes),
    );
  };
  return { requests, fetchArchive };
};

// One changed byte, in the middle of the archive.
const tampered = (bytes: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> => {
  const copy = bytes.slice();
  const middle = Math.floor(copy.length / 2);
  copy[middle] = (copy[middle] ?? 0) ^ 0xff;
  return copy;
};

// macOS scans each new executable the first time it runs, which can take a few seconds for each
// fake tool that a setup unpacks, so the tests that run setup get more than the default 5 seconds.
const SETUP = { timeout: 30_000 };

let cacheDir: string;

beforeEach(() => {
  cacheDir = mkdtempSync(join(tmpdir(), "laws-cache-"));
});

afterEach(() => {
  rmSync(cacheDir, { recursive: true, force: true });
});

describe("the pinned toolchain", () => {
  it("pins Bend 2.0.40 and Lean 4.34.0 for every platform, from their GitHub releases", async () => {
    const toolchain = await readToolchain(root);
    expect(toolchain.bend.version).toBe("2.0.40");
    expect(toolchain.lean.version).toBe("4.34.0");
    for (const [repo, release] of [
      ["bendlang/bend", toolchain.bend],
      ["leanprover/lean4", toolchain.lean],
    ] as const) {
      const archives = PLATFORMS.map((platform) => release.archives[platform]);
      for (const { url } of archives) {
        expect(url).toMatch(
          new RegExp(`^https://github\\.com/${repo}/releases/download/v${release.version}/`),
        );
      }
      expect(new Set(archives.map(({ sha256 }) => sha256)).size).toBe(PLATFORMS.length);
    }
  });

  it.each([
    ["a missing release", { bend: TOOLCHAIN.bend }, "lean is missing or not an object"],
    [
      "a missing platform",
      {
        ...TOOLCHAIN,
        lean: {
          ...TOOLCHAIN.lean,
          archives: { "linux-x64": TOOLCHAIN.lean.archives["linux-x64"] },
        },
      },
      "lean.archives.darwin-arm64 is missing or not an object",
    ],
    [
      "an unknown platform",
      {
        ...TOOLCHAIN,
        bend: { ...TOOLCHAIN.bend, archives: { ...TOOLCHAIN.bend.archives, "windows-x64": {} } },
      },
      "bend.archives names windows-x64",
    ],
    [
      "a digest in capitals",
      {
        ...TOOLCHAIN,
        bend: {
          ...TOOLCHAIN.bend,
          archives: everyPlatform({ url: BEND_URL, sha256: "A".repeat(64) }),
        },
      },
      "bend.archives.darwin-arm64.sha256 is not 64 lowercase hex digits",
    ],
    [
      "an archive in another format",
      {
        ...TOOLCHAIN,
        lean: {
          ...TOOLCHAIN.lean,
          archives: everyPlatform({ url: "https://example.test/lean.zip", sha256: "0".repeat(64) }),
        },
      },
      "lean.archives.darwin-arm64.url is not an https URL of a .tar.gz or .tar.zst archive",
    ],
    [
      "a plain HTTP URL",
      {
        ...TOOLCHAIN,
        bend: {
          ...TOOLCHAIN.bend,
          archives: everyPlatform({
            url: "http://example.test/bend.tar.gz",
            sha256: "0".repeat(64),
          }),
        },
      },
      "bend.archives.darwin-arm64.url is not an https URL",
    ],
    [
      "a version that is not x.y.z",
      { ...TOOLCHAIN, bend: { ...TOOLCHAIN.bend, version: "latest" } },
      "bend.version",
    ],
  ])("refuses a toolchain file with %s", (_case, value, message) => {
    expect(() => parseToolchain(value)).toThrow(`packages/laws/toolchain.json: ${message}`);
  });

  it("keeps each release under its version and platform in the cache", () => {
    expect(toolchainPaths(TOOLCHAIN, "/cache", "linux-x64")).toEqual({
      bend: "/cache/bend/2.0.40/linux-x64/bin/bend",
      lean: "/cache/lean/4.34.0/linux-x64",
      kernel: "/cache/bendtt/bend-2.0.40-lean-4.34.0/linux-x64/bendtt",
    });
  });
});

describe("setting up the toolchain", SETUP, () => {
  it("installs Bend and Lean, builds the kernel, and downloads nothing on a second run", async () => {
    const first = server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive });
    const lines: string[] = [];
    const result = await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: first.fetchArchive,
      log: (line) => lines.push(line),
    });
    expect(first.requests).toEqual([BEND_URL, LEAN_URL]);
    expect(result).toEqual({
      paths: toolchainPaths(TOOLCHAIN, cacheDir, PLATFORM),
      downloaded: [BEND_URL, LEAN_URL],
      builtKernel: true,
    });
    expect(lines).toEqual([
      `Downloading ${BEND_URL}`,
      `Downloading ${LEAN_URL}`,
      "Building the --verdict kernel with Lean 4.34.0",
    ]);
    expect(readFileSync(result.paths.bend, "utf8")).toBe(BEND_FILES["bin/bend"]);
    expect(existsSync(join(result.paths.lean, "lib", "lean", "Init.olean"))).toBe(true);
    const kernel = Bun.spawnSync([result.paths.kernel, "any.bendtt"]);
    expect(kernel.stdout.toString().trim()).toBe("ALL PROOFS CHECK");
    expect(readdirSync(cacheDir).toSorted()).toEqual(["bend", "bendtt", "lean"]);

    const second = server({});
    expect(
      await setupToolchain(TOOLCHAIN, {
        cacheDir,
        platform: PLATFORM,
        fetchArchive: second.fetchArchive,
      }),
    ).toEqual({ paths: result.paths, downloaded: [], builtKernel: false });
    expect(second.requests).toEqual([]);
  });

  it("builds a missing kernel without downloading", async () => {
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive }).fetchArchive,
    });
    const { kernel } = toolchainPaths(TOOLCHAIN, cacheDir, PLATFORM);
    rmSync(kernel);
    const again = server({});
    const result = await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: again.fetchArchive,
    });
    expect(again.requests).toEqual([]);
    expect(result).toMatchObject({ downloaded: [], builtKernel: true });
    expect(existsSync(kernel)).toBe(true);
  });

  it("downloads only the release that the cache lacks", async () => {
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive }).fetchArchive,
    });
    rmSync(join(cacheDir, "lean"), { recursive: true });
    const again = server({ [LEAN_URL]: leanArchive });
    const result = await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: again.fetchArchive,
    });
    expect(again.requests).toEqual([LEAN_URL]);
    expect(result).toMatchObject({ downloaded: [LEAN_URL], builtKernel: false });
  });

  it("A tampered archive", async () => {
    const { fetchArchive } = server({ [BEND_URL]: tampered(bendArchive), [LEAN_URL]: leanArchive });
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(
      `The SHA-256 of ${BEND_URL} is ${sha256Of(tampered(bendArchive))}, but packages/laws/toolchain.json pins ${sha256Of(bendArchive)}, so nothing was installed`,
    );
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("A tampered archive: Lean, after a Bend archive that matches its pin", async () => {
    const { requests, fetchArchive } = server({
      [BEND_URL]: bendArchive,
      [LEAN_URL]: tampered(leanArchive),
    });
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(`The SHA-256 of ${LEAN_URL} is`);
    expect(requests).toEqual([BEND_URL, LEAN_URL]);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("installs nothing when a download fails", async () => {
    const { fetchArchive } = server({ [BEND_URL]: bendArchive });
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(`Downloading ${LEAN_URL} failed with HTTP 404`);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("installs nothing from a release that lacks one of its tools", async () => {
    const leanc = archiveOf(
      "lean-4.34.0-darwin_aarch64",
      { "bin/lean": fakeLean("4.34.0")["bin/lean"] ?? "" },
      true,
    );
    const toolchain = toolchainOf(bendArchive, leanc);
    const { fetchArchive } = server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanc });
    await expect(
      setupToolchain(toolchain, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(`${LEAN_URL} holds no bin/leanc`);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("installs nothing from a Lean that reports another version", async () => {
    const other = archiveOf("lean-4.35.0-darwin_aarch64", fakeLean("4.35.0"), true);
    const toolchain = toolchainOf(bendArchive, other);
    const { fetchArchive } = server({ [BEND_URL]: bendArchive, [LEAN_URL]: other });
    await expect(
      setupToolchain(toolchain, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(
      `The Lean in ${LEAN_URL} reports the version 4.35.0, but packages/laws/toolchain.json pins Lean 4.34.0, so nothing was installed`,
    );
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("names a cached Lean that reports another version, for deleting", async () => {
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive }).fetchArchive,
    });
    // As a setup that installed Lean before checking its version could leave it.
    const { lean, kernel } = toolchainPaths(TOOLCHAIN, cacheDir, PLATFORM);
    writeFileSync(join(lean, "bin", "lean"), fakeLean("4.35.0")["bin/lean"] ?? "");
    rmSync(kernel);
    const again = server({});
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive: again.fetchArchive }),
    ).rejects.toThrow(
      `${join(lean, "bin", "lean")} reports the version 4.35.0, but packages/laws/toolchain.json pins Lean 4.34.0; delete ${lean} and run setup again`,
    );
    expect(again.requests).toEqual([]);
  });

  it("names a release directory that lacks one of its files, and downloads nothing", async () => {
    const { lean } = toolchainPaths(TOOLCHAIN, cacheDir, PLATFORM);
    mkdirSync(join(lean, "bin"), { recursive: true });
    writeFileSync(join(lean, "bin", "lean"), "");
    const { requests, fetchArchive } = server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive });
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(`${lean} holds no bin/leanc; delete it and run setup again`);
    expect(requests).toEqual([]);
    expect(readdirSync(cacheDir)).toEqual(["lean"]);
  });

  it("installs a release into an empty directory where it belongs", async () => {
    const { lean } = toolchainPaths(TOOLCHAIN, cacheDir, PLATFORM);
    mkdirSync(lean, { recursive: true });
    const { fetchArchive } = server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive });
    const result = await setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive });
    expect(result).toMatchObject({ downloaded: [BEND_URL, LEAN_URL], builtKernel: true });
    expect(existsSync(join(lean, "bin", "leanc"))).toBe(true);
  });

  it("names a directory at the kernel's path instead of taking it for the kernel", async () => {
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive }).fetchArchive,
    });
    const { kernel } = toolchainPaths(TOOLCHAIN, cacheDir, PLATFORM);
    rmSync(kernel);
    mkdirSync(kernel);
    await expect(
      setupToolchain(TOOLCHAIN, {
        cacheDir,
        platform: PLATFORM,
        fetchArchive: server({}).fetchArchive,
      }),
    ).rejects.toThrow(`${kernel} is not a file; delete it and run setup again`);
  });

  it("caches no kernel that refuses an empty input", async () => {
    const lean = fakeLean("4.34.0");
    const broken = archiveOf(
      "lean-4.34.0-darwin_aarch64",
      {
        ...lean,
        "bin/leanc": (lean["bin/leanc"] ?? "").replace("ALL PROOFS CHECK", "SOME PROOFS FAIL"),
      },
      true,
    );
    const toolchain = toolchainOf(bendArchive, broken);
    const { fetchArchive } = server({ [BEND_URL]: bendArchive, [LEAN_URL]: broken });
    await expect(
      setupToolchain(toolchain, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(
      'answered an empty input with "SOME PROOFS FAIL" instead of ALL PROOFS CHECK',
    );
    expect(existsSync(toolchainPaths(toolchain, cacheDir, PLATFORM).kernel)).toBe(false);
  });
});

// Calls `then` once `signal` aborts. A signal that aborted before this call fires no event, so a
// fake that a loaded runner calls late checks it first.
const whenAborted = (signal: AbortSignal, then: () => void): void => {
  if (signal.aborted) {
    then();
  } else {
    signal.addEventListener("abort", then, { once: true });
  }
};

// A response that sends `bytes` in four chunks and fails once its request is aborted, as the body
// of a real fetch does.
const abortable = (bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const quarter = Math.ceil(bytes.length / 4);
        for (let start = 0; start < bytes.length; start += quarter) {
          controller.enqueue(bytes.slice(start, start + quarter));
        }
        controller.close();
        whenAborted(signal, () => controller.error(signal.reason));
      },
    }),
  );

// A response that sends `bytes` and then nothing until its request is aborted, as a stalled proxy does.
const stalling = (bytes: Uint8Array<ArrayBuffer>, signal: AbortSignal): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes);
        whenAborted(signal, () => controller.error(signal.reason));
      },
    }),
  );

// The part of `bytes` from `start` on, as a server answers a Range request.
const partial = (bytes: Uint8Array<ArrayBuffer>, start: number): Response =>
  new Response(bytes.slice(start), {
    status: 206,
    headers: { "content-range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` },
  });

// Where a Range request asks the archive to start, or 0 for a request without one.
const rangeStart = (headers: Readonly<Record<string, string>>): number =>
  Number(/^bytes=(\d+)-$/.exec(headers["range"] ?? "")?.[1] ?? 0);

// A response to a request from `start` on that sends `bytes` up to `end` and then fails, as a
// proxy that drops the connection does, unless it reached the end of `bytes`.
const dropping = (bytes: Uint8Array<ArrayBuffer>, start: number, end: number): Response => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(bytes.slice(start, end));
    },
    pull(controller) {
      if (end < bytes.length) {
        controller.error(new Error("The socket connection was closed unexpectedly"));
      } else {
        controller.close();
      }
    },
  });
  return start === 0
    ? new Response(body)
    : new Response(body, {
        status: 206,
        headers: { "content-range": `bytes ${start}-${bytes.length - 1}/${bytes.length}` },
      });
};

const HALF = Math.floor(leanArchive.length / 2);
const HALF_MIB = `${(HALF / 2 ** 20).toFixed(1)} MiB`;

describe("a download that stops", SETUP, () => {
  it("resumes where it stopped, with a Range request, when nothing arrives", async () => {
    const ranges: (string | undefined)[] = [];
    const fetchArchive: FetchArchive = (url, { signal, headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      ranges.push(headers["range"]);
      return Promise.resolve(
        headers["range"] === undefined
          ? stalling(leanArchive.slice(0, HALF), signal)
          : partial(leanArchive, HALF),
      );
    };
    const lines: string[] = [];
    const result = await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive,
      stallMs: 50,
      log: (line) => lines.push(line),
    });
    expect(ranges).toEqual([undefined, `bytes=${HALF}-`]);
    expect(lines).toContain(
      `After ${HALF_MIB}, the download received nothing for 0.05 s; resuming it`,
    );
    expect(result).toMatchObject({ downloaded: [BEND_URL, LEAN_URL], builtKernel: true });
  });

  it("resumes after a connection that fails", async () => {
    let calls = 0;
    const fetchArchive: FetchArchive = (url, { headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      calls += 1;
      if (headers["range"] !== undefined) {
        return Promise.resolve(partial(leanArchive, HALF));
      }
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            // Errors on the read after the first chunk; erroring in start would drop that chunk.
            start(controller) {
              controller.enqueue(leanArchive.slice(0, HALF));
            },
            pull(controller) {
              controller.error(new Error("The socket connection was closed unexpectedly"));
            },
          }),
        ),
      );
    };
    const lines: string[] = [];
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive,
      log: (line) => lines.push(line),
    });
    expect(calls).toBe(2);
    expect(lines).toContain(
      `After ${HALF_MIB}, the download failed: The socket connection was closed unexpectedly; resuming it`,
    );
  });

  it("resumes after a server error, as a proxy that lost its upstream answers", async () => {
    const statuses: number[] = [];
    const fetchArchive: FetchArchive = (url) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      const response =
        statuses.length === 0
          ? new Response("Bad Gateway", { status: 502 })
          : new Response(leanArchive);
      statuses.push(response.status);
      return Promise.resolve(response);
    };
    const lines: string[] = [];
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive,
      log: (line) => lines.push(line),
    });
    expect(statuses).toEqual([502, 200]);
    expect(lines).toContain(
      `After 0.0 MiB, the download failed: Downloading ${LEAN_URL} failed with HTTP 502; resuming it`,
    );
  });

  it("finishes when a resume after the last byte is answered with 416", async () => {
    const ranges: (string | undefined)[] = [];
    const fetchArchive: FetchArchive = (url, { headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      ranges.push(headers["range"]);
      if (headers["range"] !== undefined) {
        return Promise.resolve(
          new Response("Range Not Satisfiable", {
            status: 416,
            headers: { "content-range": `bytes */${leanArchive.length}` },
          }),
        );
      }
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            // Every byte arrives, and then the connection fails.
            start(controller) {
              controller.enqueue(leanArchive);
            },
            pull(controller) {
              controller.error(new Error("The socket connection was closed unexpectedly"));
            },
          }),
        ),
      );
    };
    const result = await setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive });
    expect(ranges).toEqual([undefined, `bytes=${leanArchive.length}-`]);
    expect(result).toMatchObject({ downloaded: [BEND_URL, LEAN_URL], builtKernel: true });
  });

  it.each([
    ["the length of a longer archive", { "content-range": `bytes */${leanArchive.length}` }],
    ["no length", {}],
  ])("refuses a resume answered with 416 and %s", async (_case, rangeHeaders) => {
    const fetchArchive: FetchArchive = (url, { headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      return Promise.resolve(
        headers["range"] === undefined
          ? dropping(leanArchive, 0, HALF)
          : new Response("Range Not Satisfiable", { status: 416, headers: rangeHeaders }),
      );
    };
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(`Downloading ${LEAN_URL} failed with HTTP 416`);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("retries a resume answered with a range that starts elsewhere", async () => {
    const ranges: (string | undefined)[] = [];
    const fetchArchive: FetchArchive = (url, { headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      ranges.push(headers["range"]);
      if (ranges.length === 1) {
        return Promise.resolve(dropping(leanArchive, 0, HALF));
      }
      return Promise.resolve(partial(leanArchive, ranges.length === 2 ? HALF + 10 : HALF));
    };
    const lines: string[] = [];
    const result = await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive,
      log: (line) => lines.push(line),
    });
    expect(ranges).toEqual([undefined, `bytes=${HALF}-`, `bytes=${HALF}-`]);
    expect(lines).toContain(
      `After ${HALF_MIB}, the download failed: Downloading ${LEAN_URL} sent bytes ${HALF + 10}-${leanArchive.length - 1}/${leanArchive.length} instead of the bytes from ${HALF} on; resuming it`,
    );
    expect(result.builtKernel).toBe(true);
  });

  it("starts again from the beginning when the server ignores the Range request", async () => {
    let calls = 0;
    const fetchArchive: FetchArchive = (url, { signal }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      calls += 1;
      return Promise.resolve(
        calls === 1 ? stalling(leanArchive.slice(0, HALF), signal) : new Response(leanArchive),
      );
    };
    const result = await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive,
      stallMs: 50,
    });
    expect(calls).toBe(2);
    expect(result.builtKernel).toBe(true);
  });

  it("resumes for as long as each attempt receives bytes", async () => {
    const chunk = Math.ceil(leanArchive.length / 8);
    const starts: number[] = [];
    const fetchArchive: FetchArchive = (url, { headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      const start = rangeStart(headers);
      starts.push(start);
      return Promise.resolve(
        dropping(leanArchive, start, Math.min(start + chunk, leanArchive.length)),
      );
    };
    const result = await setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive });
    expect(starts).toEqual(Array.from({ length: 8 }, (_, index) => index * chunk));
    expect(result).toMatchObject({ downloaded: [BEND_URL, LEAN_URL], builtKernel: true });
  });

  it("counts only the attempts in a row that receive nothing", async () => {
    let calls = 0;
    const fetchArchive: FetchArchive = (url, { headers }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      calls += 1;
      // Four server errors before each half of the archive, so eight attempts receive nothing.
      if (calls % 5 !== 0) {
        return Promise.resolve(new Response("Bad Gateway", { status: 502 }));
      }
      const start = rangeStart(headers);
      return Promise.resolve(dropping(leanArchive, start, start === 0 ? HALF : leanArchive.length));
    };
    const result = await setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive });
    expect(calls).toBe(10);
    expect(result.builtKernel).toBe(true);
  });

  it("gives up on a server that ignores the Range request and drops at alternating points", async () => {
    // In eighths of the archive. After the first, every attempt starts again from byte 0 and ends
    // short of where the first one did, though often above where it started.
    const drops = [4, 2, 3, 2, 3, 2, 3, 2, 3, 2];
    const eighth = Math.floor(leanArchive.length / 8);
    let calls = 0;
    const fetchArchive: FetchArchive = (url) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      const drop = drops[calls];
      calls += 1;
      // Then the whole archive, so a rule that never gives up ends the test instead of hanging it.
      return Promise.resolve(
        drop === undefined ? new Response(leanArchive) : dropping(leanArchive, 0, drop * eighth),
      );
    };
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
    ).rejects.toThrow(
      `Downloading ${LEAN_URL} got no further in 5 attempts in a row, so nothing was installed. After 0.0 MiB, the last attempt failed: The socket connection was closed unexpectedly`,
    );
    expect(calls).toBe(6);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("gives up after five attempts in a row that receive nothing, and installs nothing", async () => {
    let calls = 0;
    const fetchArchive: FetchArchive = (url, { signal }) => {
      if (url === BEND_URL) {
        return Promise.resolve(new Response(bendArchive));
      }
      calls += 1;
      return new Promise((_resolve, reject) => {
        whenAborted(signal, () => reject(signal.reason));
      });
    };
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive, stallMs: 20 }),
    ).rejects.toThrow(
      `Downloading ${LEAN_URL} got no further in 5 attempts in a row, so nothing was installed. After 0.0 MiB, the last attempt received nothing for 0.02 s`,
    );
    expect(calls).toBe(5);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("does not count the time the file takes to open as a stall", async () => {
    const requests: string[] = [];
    // Like fetch, the fake fails at once when its request was aborted before the call.
    const fetchArchive: FetchArchive = (url, { signal }) => {
      requests.push(url);
      return signal.aborted
        ? Promise.reject(signal.reason)
        : Promise.resolve(new Response(url === BEND_URL ? bendArchive : leanArchive));
    };
    disk.openMs = 100;
    try {
      await setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive, stallMs: 20 });
    } finally {
      disk.openMs = 0;
    }
    expect(requests).toEqual([BEND_URL, LEAN_URL]);
  });

  it("does not count the time a chunk takes to write as a stall", async () => {
    const requests: string[] = [];
    const fetchArchive: FetchArchive = (url, { signal }) => {
      requests.push(url);
      return Promise.resolve(abortable(url === BEND_URL ? bendArchive : leanArchive, signal));
    };
    disk.writeMs = 100;
    try {
      await setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive, stallMs: 20 });
    } finally {
      disk.writeMs = 0;
    }
    expect(requests).toEqual([BEND_URL, LEAN_URL]);
  });

  it("stops at once when the archive cannot be written", async () => {
    const { requests, fetchArchive } = server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive });
    disk.writeError = Object.assign(new Error("ENOSPC: no space left on device, write"), {
      code: "ENOSPC",
    });
    const file = join(cacheDir, `.laws-setup-${process.pid}`, "bend-2.0.40-darwin-arm64.tar.gz");
    try {
      await expect(
        setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive }),
      ).rejects.toThrow(`Setup could not write ${file}: ENOSPC: no space left on device, write`);
    } finally {
      delete disk.writeError;
    }
    expect(requests).toEqual([BEND_URL]);
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("does not retry a download that the server refuses", async () => {
    const { requests, fetchArchive } = server({ [BEND_URL]: bendArchive });
    await expect(
      setupToolchain(TOOLCHAIN, { cacheDir, platform: PLATFORM, fetchArchive, stallMs: 20 }),
    ).rejects.toThrow(`Downloading ${LEAN_URL} failed with HTTP 404`);
    expect(requests).toEqual([BEND_URL, LEAN_URL]);
  });
});

describe("a run that was killed", SETUP, () => {
  it("leaves a staging directory that the next run removes, unless its process still runs", async () => {
    // No process has this PID: it is above the largest that Linux or macOS hands out.
    const killed = `.laws-setup-${2 ** 22 + 1}`;
    mkdirSync(join(cacheDir, killed));
    writeFileSync(join(cacheDir, killed, "lean-4.34.0-darwin_aarch64.tar.zst"), "partial");
    const running = `.laws-setup-${process.ppid}`;
    mkdirSync(join(cacheDir, running));
    await setupToolchain(TOOLCHAIN, {
      cacheDir,
      platform: PLATFORM,
      fetchArchive: server({ [BEND_URL]: bendArchive, [LEAN_URL]: leanArchive }).fetchArchive,
    });
    expect(readdirSync(cacheDir).toSorted()).toEqual([running, "bend", "bendtt", "lean"]);
  });
});
