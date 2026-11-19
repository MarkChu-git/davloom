import { chmodSync, existsSync, mkdirSync, mkdtempSync, renameSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join } from "node:path";

// Third-party CLIs that CI and contributors run at pinned versions (add-ci-baseline, Decision 5).
// Each asset is one platform's release download with the SHA-256 that GitHub records for it, which
// matches the checksum file the project publishes where it has one. `bun scripts/tool.ts <name>`
// downloads an asset once, checks it, keeps the executable in a cache shared by every checkout and
// runs it. A cached executable is trusted like Bun's own install cache; deleting the cache directory
// makes the next run download and check it again.

export const PLATFORMS = ["darwin-arm64", "darwin-x64", "linux-arm64", "linux-x64"] as const;
export type Platform = (typeof PLATFORMS)[number];

export interface Asset {
  readonly url: string;
  readonly sha256: string;
}

export interface Tool {
  readonly version: string;
  /** The executable's file name: the download itself, or a file inside the downloaded .tar.gz. */
  readonly executable: string;
  readonly assets: Readonly<Record<Platform, Asset>>;
}

const release = (repo: string, tag: string, file: string, sha256: string): Asset => ({
  url: `https://github.com/${repo}/releases/download/${tag}/${file}`,
  sha256,
});

export const TOOLS: Readonly<Record<string, Tool>> = {
  // Checked against osv-scanner_SHA256SUMS of the release.
  "osv-scanner": {
    version: "2.7.1",
    executable: "osv-scanner",
    assets: {
      "darwin-arm64": release(
        "google/osv-scanner",
        "v2.7.1",
        "osv-scanner_darwin_arm64",
        "b22c02877a811c8f78956e8643efa554932b7378f590d13f8e97d4e9448a29f3",
      ),
      "darwin-x64": release(
        "google/osv-scanner",
        "v2.7.1",
        "osv-scanner_darwin_amd64",
        "b8420d5485ba792626315f1bf9a5a2046e971d38eea75bf9090c38852dbc3b1b",
      ),
      "linux-arm64": release(
        "google/osv-scanner",
        "v2.7.1",
        "osv-scanner_linux_arm64",
        "983d22fbad9724514e3fcc6acc83b5fa64c5ffa6b0d9f510028f22c1b223ff81",
      ),
      "linux-x64": release(
        "google/osv-scanner",
        "v2.7.1",
        "osv-scanner_linux_amd64",
        "fb7dab19a8bd9bbe5c3189f09d4b7ee1820c9553a23bac202648a56efd2f6ee8",
      ),
    },
  },
  // Checked against gitleaks_8.30.1_checksums.txt of the release.
  gitleaks: {
    version: "8.30.1",
    executable: "gitleaks",
    assets: {
      "darwin-arm64": release(
        "gitleaks/gitleaks",
        "v8.30.1",
        "gitleaks_8.30.1_darwin_arm64.tar.gz",
        "b40ab0ae55c505963e365f271a8d3846efbc170aa17f2607f13df610a9aeb6a5",
      ),
      "darwin-x64": release(
        "gitleaks/gitleaks",
        "v8.30.1",
        "gitleaks_8.30.1_darwin_x64.tar.gz",
        "dfe101a4db2255fc85120ac7f3d25e4342c3c20cf749f2c20a18081af1952709",
      ),
      "linux-arm64": release(
        "gitleaks/gitleaks",
        "v8.30.1",
        "gitleaks_8.30.1_linux_arm64.tar.gz",
        "e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080",
      ),
      "linux-x64": release(
        "gitleaks/gitleaks",
        "v8.30.1",
        "gitleaks_8.30.1_linux_x64.tar.gz",
        "551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb",
      ),
    },
  },
};

const isPlatform = (value: string): value is Platform =>
  PLATFORMS.some((platform) => platform === value);

/** The platform key for `process.platform` and `process.arch`. */
export const platformOf = (os: string, arch: string): Platform => {
  const platform = `${os}-${arch}`;
  if (isPlatform(platform)) {
    return platform;
  }
  throw new Error(
    `No pinned tool builds for ${platform}; scripts/lib/tools.ts has ${PLATFORMS.join(", ")}`,
  );
};

/**
 * `$DAVLOOM_TOOL_CACHE`, or `davloom/tools` under `$XDG_CACHE_HOME` or `~/.cache`. An empty
 * variable counts as unset, and so does a relative `$XDG_CACHE_HOME`, as the XDG spec says;
 * either would otherwise put the cache inside the checkout.
 */
export const toolCacheDir = (env: Readonly<Record<string, string | undefined>>): string => {
  const own = env.DAVLOOM_TOOL_CACHE;
  if (own !== undefined && own !== "") {
    return own;
  }
  const xdg = env.XDG_CACHE_HOME;
  const cacheHome = xdg !== undefined && isAbsolute(xdg) ? xdg : join(homedir(), ".cache");
  return join(cacheHome, "davloom", "tools");
};

export const sha256Of = (bytes: Uint8Array): string =>
  new Bun.CryptoHasher("sha256").update(bytes).digest("hex");

export interface EnsureOptions {
  readonly cacheDir: string;
  readonly platform: Platform;
  readonly fetchAsset?: (url: string) => Promise<Response>;
}

/**
 * Returns the path of the tool's executable, downloading and checking it first when the cache
 * lacks it. A download whose SHA-256 differs from the pinned one fails and leaves nothing behind.
 */
export const ensureTool = async (
  name: string,
  tool: Tool,
  { cacheDir, platform, fetchAsset = fetch }: EnsureOptions,
): Promise<string> => {
  const asset = tool.assets[platform];
  const target = join(cacheDir, name, tool.version, platform);
  const executable = join(target, tool.executable);
  if (existsSync(executable)) {
    return executable;
  }

  const response = await fetchAsset(asset.url);
  if (!response.ok) {
    throw new Error(`Downloading ${asset.url} failed with HTTP ${response.status}`);
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  const actual = sha256Of(bytes);
  if (actual !== asset.sha256) {
    throw new Error(
      `The SHA-256 of ${asset.url} is ${actual}, but scripts/lib/tools.ts pins ${asset.sha256} for ${name} ${tool.version}`,
    );
  }

  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(join(dirname(target), `.${platform}-`));
  try {
    const out = join(staging, "out");
    mkdirSync(out);
    if (asset.url.endsWith(".tar.gz")) {
      const archive = join(staging, "download.tar.gz");
      await Bun.write(archive, bytes);
      const extracted = join(staging, "extracted");
      mkdirSync(extracted);
      const tar = Bun.spawnSync(["tar", "-xzf", archive, "-C", extracted], { stderr: "pipe" });
      if (tar.exitCode !== 0) {
        throw new Error(`tar could not extract ${asset.url}: ${tar.stderr.toString().trim()}`);
      }
      const [found] = [...new Bun.Glob(`**/${tool.executable}`).scanSync({ cwd: extracted })];
      if (found === undefined) {
        throw new Error(`${asset.url} holds no file named ${tool.executable}`);
      }
      renameSync(join(extracted, found), join(out, tool.executable));
    } else {
      await Bun.write(join(out, tool.executable), bytes);
    }
    chmodSync(join(out, tool.executable), 0o755);
    try {
      renameSync(out, target);
    } catch (error) {
      // Another run cached the same version first; its executable passed the same check.
      if (!existsSync(executable)) {
        throw error;
      }
    }
  } finally {
    rmSync(staging, { recursive: true, force: true });
  }
  return executable;
};
