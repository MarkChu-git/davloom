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
  // Checked against actionlint_1.7.12_checksums.txt of the release.
  actionlint: {
    version: "1.7.12",
    executable: "actionlint",
    assets: {
      "darwin-arm64": release(
        "rhysd/actionlint",
        "v1.7.12",
        "actionlint_1.7.12_darwin_arm64.tar.gz",
        "aba9ced2dee8d27fecca3dc7feb1a7f9a52caefa1eb46f3271ea66b6e0e6953f",
      ),
      "darwin-x64": release(
        "rhysd/actionlint",
        "v1.7.12",
        "actionlint_1.7.12_darwin_amd64.tar.gz",
        "5b44c3bc2255115c9b69e30efc0fecdf498fdb63c5d58e17084fd5f16324c644",
      ),
      "linux-arm64": release(
        "rhysd/actionlint",
        "v1.7.12",
        "actionlint_1.7.12_linux_arm64.tar.gz",
        "325e971b6ba9bfa504672e29be93c24981eeb1c07576d730e9f7c8805afff0c6",
      ),
      "linux-x64": release(
        "rhysd/actionlint",
        "v1.7.12",
        "actionlint_1.7.12_linux_amd64.tar.gz",
        "8aca8db96f1b94770f1b0d72b6dddcb1ebb8123cb3712530b08cc387b349a3d8",
      ),
    },
  },
  // The release publishes no checksum file; these are the digests GitHub records for its assets.
  zizmor: {
    version: "1.32.0",
    executable: "zizmor",
    assets: {
      "darwin-arm64": release(
        "zizmorcore/zizmor",
        "v1.32.0",
        "zizmor-aarch64-apple-darwin.tar.gz",
        "6efed18c4539a663fd3c851a2be9533fd8456c4e646d9416206da059154a0d3c",
      ),
      "darwin-x64": release(
        "zizmorcore/zizmor",
        "v1.32.0",
        "zizmor-x86_64-apple-darwin.tar.gz",
        "6983143c719ada6845a69cc4dd2bacc215f971662fecd8bbd2678388e5ce5969",
      ),
      "linux-arm64": release(
        "zizmorcore/zizmor",
        "v1.32.0",
        "zizmor-aarch64-unknown-linux-gnu.tar.gz",
        "cb152b207f815116d7fa1c1ee4614f61578803351395052908095e79adfd9fd0",
      ),
      "linux-x64": release(
        "zizmorcore/zizmor",
        "v1.32.0",
        "zizmor-x86_64-unknown-linux-gnu.tar.gz",
        "bb110cc765eca9cd7efb2e284a956be5974c60027b0970f16397d86208a9957b",
      ),
    },
  },
  // The release workflow's image scan (PRD §11: Trivy scans only images, Dockerfiles and Compose
  // files). The release binary, not trivy-action, whose tags were force-pushed in March 2026.
  // Checked against trivy_0.76.2_checksums.txt of the release.
  trivy: {
    version: "0.76.2",
    executable: "trivy",
    assets: {
      "darwin-arm64": release(
        "aquasecurity/trivy",
        "v0.76.2",
        "trivy_0.76.2_macOS-ARM64.tar.gz",
        "ae7ea358326960406b703c77b2ac490190797d80b306b5b50c2a27221da0a5b8",
      ),
      "darwin-x64": release(
        "aquasecurity/trivy",
        "v0.76.2",
        "trivy_0.76.2_macOS-64bit.tar.gz",
        "e08bb9ea449ecf66c6bfb03cbb8697c503ff33d35fc585c9747e3eaeb7ed4c7b",
      ),
      "linux-arm64": release(
        "aquasecurity/trivy",
        "v0.76.2",
        "trivy_0.76.2_Linux-ARM64.tar.gz",
        "ab9d51f86e6a5fb936f605faff6b593ac51bc378fff4d3e8b9d58358b9c367c3",
      ),
      "linux-x64": release(
        "aquasecurity/trivy",
        "v0.76.2",
        "trivy_0.76.2_Linux-64bit.tar.gz",
        "bc0fc726e017b8927a62b2d3531d7a84ee01769daf5c99ed866dced54089fdbf",
      ),
    },
  },
  // The release image's SBOM. Checked against syft_1.57.2_checksums.txt of the release.
  syft: {
    version: "1.57.2",
    executable: "syft",
    assets: {
      "darwin-arm64": release(
        "anchore/syft",
        "v1.57.2",
        "syft_1.57.2_darwin_arm64.tar.gz",
        "38afbcc03a9d9afac2d7572432fd2c435e051e03930582ea90f4710ffb515224",
      ),
      "darwin-x64": release(
        "anchore/syft",
        "v1.57.2",
        "syft_1.57.2_darwin_amd64.tar.gz",
        "73c6100bc43fbcc1c99aed3428d859c6289c4076be7e296dde7e427324c15908",
      ),
      "linux-arm64": release(
        "anchore/syft",
        "v1.57.2",
        "syft_1.57.2_linux_arm64.tar.gz",
        "8efe605309c98798e1ee0cffdcf8c05ca26819b4cd44c0b03650f1e963e9bdb6",
      ),
      "linux-x64": release(
        "anchore/syft",
        "v1.57.2",
        "syft_1.57.2_linux_amd64.tar.gz",
        "ad92bd3ec1b94a3df01d4d0aec199afa9c42b72e86da436ff5f837914d32706b",
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

const isAbsolutePath = (value: string | undefined): value is string =>
  value !== undefined && isAbsolute(value);

/**
 * `$DAVLOOM_TOOL_CACHE`, or `davloom/tools` under `$XDG_CACHE_HOME` or `~/.cache`. A variable
 * that is empty or holds a relative path counts as unset, as the XDG spec says for
 * `$XDG_CACHE_HOME`, because a relative path would put the cache under the current directory.
 */
export const toolCacheDir = (env: Readonly<Record<string, string | undefined>>): string => {
  if (isAbsolutePath(env.DAVLOOM_TOOL_CACHE)) {
    return env.DAVLOOM_TOOL_CACHE;
  }
  const cacheHome = isAbsolutePath(env.XDG_CACHE_HOME)
    ? env.XDG_CACHE_HOME
    : join(homedir(), ".cache");
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
