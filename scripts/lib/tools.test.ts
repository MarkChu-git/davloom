import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  PLATFORMS,
  TOOLS,
  type Tool,
  ensureTool,
  platformOf,
  sha256Of,
  toolCacheDir,
} from "./tools";

const temporaryDirs: string[] = [];
const temporaryDir = (): string => {
  const dir = mkdtempSync(join(tmpdir(), "davloom-tools-test-"));
  temporaryDirs.push(dir);
  return dir;
};
afterEach(() => {
  for (const dir of temporaryDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const readBytes = async (path: string): Promise<Uint8Array> => await Bun.file(path).bytes();

const fakeTool = (url: string, sha256: string): Tool => ({
  version: "1.0.0",
  executable: "fake",
  assets: {
    "darwin-arm64": { url, sha256 },
    "darwin-x64": { url, sha256 },
    "linux-arm64": { url, sha256 },
    "linux-x64": { url, sha256 },
  },
});

const serving = (bytes: Uint8Array, status = 200) => {
  const requests: string[] = [];
  const fetchAsset = async (url: string): Promise<Response> => {
    requests.push(url);
    return new Response(status === 200 ? new Uint8Array(bytes) : "not found", { status });
  };
  return { requests, fetchAsset };
};

describe("the pinned tools", () => {
  it("pin a release download of their version, with a SHA-256, for every platform", () => {
    for (const [name, tool] of Object.entries(TOOLS)) {
      for (const platform of PLATFORMS) {
        const { url, sha256 } = tool.assets[platform];
        const release = `^https://github\\.com/[\\w.-]+/[\\w.-]+/releases/download/v${tool.version}/`;
        expect(url, `${name} on ${platform}`).toMatch(new RegExp(release));
        expect(sha256, `${name} on ${platform}`).toMatch(/^[0-9a-f]{64}$/);
      }
    }
  });
});

describe("platformOf", () => {
  it.each([
    ["darwin", "arm64", "darwin-arm64"],
    ["darwin", "x64", "darwin-x64"],
    ["linux", "arm64", "linux-arm64"],
    ["linux", "x64", "linux-x64"],
  ])("maps %s on %s to %s", (os, arch, platform) => {
    expect(platformOf(os, arch)).toBe(platform);
  });

  it("names the platform it has no builds for, and the ones it has", () => {
    expect(() => platformOf("win32", "x64")).toThrow(
      "No pinned tool builds for win32-x64; scripts/lib/tools.ts has darwin-arm64",
    );
  });
});

describe("toolCacheDir", () => {
  it("prefers DAVLOOM_TOOL_CACHE, then XDG_CACHE_HOME", () => {
    expect(toolCacheDir({ DAVLOOM_TOOL_CACHE: "/c", XDG_CACHE_HOME: "/x" })).toBe("/c");
    expect(toolCacheDir({ XDG_CACHE_HOME: "/x" })).toBe("/x/davloom/tools");
  });
});

describe("ensureTool", () => {
  it("downloads a bare executable once, checks it and makes it executable", async () => {
    const bytes = new TextEncoder().encode("#!/bin/sh\necho fake\n");
    const { requests, fetchAsset } = serving(bytes);
    const tool = fakeTool("https://example.test/fake", sha256Of(bytes));
    const cacheDir = temporaryDir();

    const first = await ensureTool("fake", tool, { cacheDir, platform: "linux-x64", fetchAsset });
    const second = await ensureTool("fake", tool, { cacheDir, platform: "linux-x64", fetchAsset });

    expect(first).toBe(join(cacheDir, "fake", "1.0.0", "linux-x64", "fake"));
    expect(second).toBe(first);
    expect(requests).toEqual(["https://example.test/fake"]);
    expect(await readBytes(first)).toEqual(bytes);
    expect(statSync(first).mode & 0o111).toBe(0o111);
  });

  it("takes the executable out of a .tar.gz, even from a directory inside it", async () => {
    const dir = temporaryDir();
    mkdirSync(join(dir, "src", "fake-1.0.0"), { recursive: true });
    writeFileSync(join(dir, "src", "fake-1.0.0", "fake"), "#!/bin/sh\necho fake\n");
    writeFileSync(join(dir, "src", "LICENSE"), "license");
    const archive = join(dir, "fake.tar.gz");
    expect(Bun.spawnSync(["tar", "-czf", archive, "-C", join(dir, "src"), "."]).exitCode).toBe(0);
    const bytes = await readBytes(archive);
    const { fetchAsset } = serving(bytes);
    const cacheDir = temporaryDir();

    const executable = await ensureTool(
      "fake",
      fakeTool("https://example.test/fake.tar.gz", sha256Of(bytes)),
      { cacheDir, platform: "darwin-arm64", fetchAsset },
    );

    expect(await Bun.file(executable).text()).toBe("#!/bin/sh\necho fake\n");
    expect(readdirSync(join(cacheDir, "fake", "1.0.0", "darwin-arm64"))).toEqual(["fake"]);
  });

  it("refuses a download whose SHA-256 differs from the pin and caches nothing", async () => {
    const bytes = new TextEncoder().encode("tampered");
    const pinned = "0".repeat(64);
    const { fetchAsset } = serving(bytes);
    const cacheDir = temporaryDir();
    const tool = fakeTool("https://example.test/fake", pinned);

    await expect(
      ensureTool("fake", tool, { cacheDir, platform: "linux-x64", fetchAsset }),
    ).rejects.toThrow(
      `The SHA-256 of https://example.test/fake is ${sha256Of(bytes)}, but scripts/lib/tools.ts pins ${pinned} for fake 1.0.0`,
    );
    expect(readdirSync(cacheDir)).toEqual([]);
  });

  it("reports a failed download with its status", async () => {
    const { fetchAsset } = serving(new Uint8Array(), 404);
    const tool = fakeTool("https://example.test/missing", "0".repeat(64));

    await expect(
      ensureTool("fake", tool, { cacheDir: temporaryDir(), platform: "linux-x64", fetchAsset }),
    ).rejects.toThrow("Downloading https://example.test/missing failed with HTTP 404");
  });

  it("names the executable that an archive lacks", async () => {
    const dir = temporaryDir();
    mkdirSync(join(dir, "src"));
    writeFileSync(join(dir, "src", "README.md"), "no executable here");
    const archive = join(dir, "empty.tar.gz");
    expect(Bun.spawnSync(["tar", "-czf", archive, "-C", join(dir, "src"), "."]).exitCode).toBe(0);
    const bytes = await readBytes(archive);
    const { fetchAsset } = serving(bytes);
    const cacheDir = temporaryDir();

    await expect(
      ensureTool("fake", fakeTool("https://example.test/empty.tar.gz", sha256Of(bytes)), {
        cacheDir,
        platform: "linux-x64",
        fetchAsset,
      }),
    ).rejects.toThrow("https://example.test/empty.tar.gz holds no file named fake");
    expect(readdirSync(join(cacheDir, "fake", "1.0.0"))).toEqual([]);
  });
});
