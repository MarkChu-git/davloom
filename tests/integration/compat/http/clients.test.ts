import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDavloom, type Davloom } from "./davloom";

// Real WebDAV clients against the production Worker in local workerd. CI installs litmus and
// rclone; a machine without them skips these tests.

const has = (command: string) => spawnSync("sh", ["-c", `command -v ${command}`]).status === 0;
const LITMUS_SUITES = ["basic", "copymove", "props", "locks", "http"];

let davloom: Davloom;
let workdir: string;

beforeAll(async () => {
  davloom = await startDavloom();
  workdir = mkdtempSync(join(tmpdir(), "davloom-clients-"));
});
afterAll(async () => {
  await davloom?.server.stop();
  if (workdir) rmSync(workdir, { recursive: true, force: true });
});

describe.skipIf(!has("litmus"))("litmus", () => {
  it.each(LITMUS_SUITES)("passes every test of the %s suite", { timeout: 120_000 }, (suite) => {
    const result = spawnSync(
      "litmus",
      [`${davloom.server.url}/dav/files/`, "davloom", davloom.readWriteKey],
      {
        env: { ...process.env, TESTS: suite },
        encoding: "utf8",
        timeout: 110_000,
      },
    );
    const summary = result.stdout.match(
      /summary for `\w+': of (\d+) tests run: (\d+) passed, (\d+) failed/,
    );
    expect(summary, result.stdout + result.stderr).not.toBeNull();
    expect(summary?.[3], result.stdout).toBe("0");
    // The one warning litmus may give: Fetch drops a URL's fragment before the Worker sees it, so
    // `DELETE /frag/#ment` reaches the Worker as `DELETE /frag/`. No client sends a fragment.
    const warnings = result.stdout.split("\n").filter((line) => line.includes("WARNING"));
    expect(
      warnings.filter((line) => !line.includes("delete_fragment")),
      result.stdout,
    ).toEqual([]);
  });
});

const rclone = (...args: string[]) =>
  spawnSync("rclone", ["--config", "/dev/null", ...args], {
    input: "streamed through rcat",
    env: {
      ...process.env,
      RCLONE_CONFIG_DAV_TYPE: "webdav",
      RCLONE_CONFIG_DAV_URL: `${davloom.server.url}/dav/files`,
      RCLONE_CONFIG_DAV_VENDOR: "other",
      RCLONE_CONFIG_DAV_USER: "davloom",
      RCLONE_CONFIG_DAV_PASS: spawnSync("rclone", ["obscure", davloom.readWriteKey], {
        encoding: "utf8",
      }).stdout.trim(),
    },
    encoding: "utf8",
    timeout: 60_000,
  });

const ok = (...args: string[]) => {
  const result = rclone(...args);
  expect(result.status, `rclone ${args.join(" ")}\n${result.stderr}`).toBe(0);
  return result.stdout;
};

describe.skipIf(!has("rclone"))("rclone", () => {
  it("copies a tree up and down unchanged", { timeout: 120_000 }, () => {
    const source = join(workdir, "source");
    mkdirSync(join(source, "sub", "深"), { recursive: true });
    const big = Uint8Array.from({ length: 3 * 1024 * 1024 + 5 }, (_, i) => (i * 13) % 256);
    writeFileSync(join(source, "big.bin"), big);
    writeFileSync(join(source, "sub", "a b#c%d.txt"), "spaces and signs");
    writeFileSync(join(source, "sub", "深", "😀.md"), "unicode");
    writeFileSync(join(source, "empty"), "");
    ok("mkdir", "dav:rclone");
    ok("copy", source, "dav:rclone");
    ok("check", source, "dav:rclone", "--size-only");
    const listing = ok("lsf", "-R", "dav:rclone");
    expect(
      listing
        .split("\n")
        .filter(Boolean)
        .toSorted((a, b) => a.localeCompare(b)),
    ).toEqual(
      ["big.bin", "empty", "sub/", "sub/a b#c%d.txt", "sub/深/", "sub/深/😀.md"].toSorted((a, b) =>
        a.localeCompare(b),
      ),
    );
    const back = join(workdir, "back");
    ok("copy", "dav:rclone", back);
    expect(new Uint8Array(readFileSync(join(back, "big.bin")))).toEqual(big);
    expect(readFileSync(join(back, "sub", "深", "😀.md"), "utf8")).toBe("unicode");
  });

  it("moves, renames and deletes", { timeout: 120_000 }, () => {
    ok("mkdir", "dav:moves/a");
    ok("rcat", "dav:moves/a/f.txt", "--streaming-upload-cutoff", "0");
    ok("moveto", "dav:moves/a", "dav:moves/b");
    expect(ok("lsf", "-R", "dav:moves")).toBe("b/\nb/f.txt\n");
    ok("deletefile", "dav:moves/b/f.txt");
    ok("purge", "dav:moves");
    expect(rclone("lsf", "dav:moves").status).not.toBe(0);
  });

  it("a Read Only key can list and download but not upload", { timeout: 60_000 }, () => {
    const env = {
      ...process.env,
      RCLONE_CONFIG_RO_TYPE: "webdav",
      RCLONE_CONFIG_RO_URL: `${davloom.server.url}/dav/files`,
      RCLONE_CONFIG_RO_VENDOR: "other",
      RCLONE_CONFIG_RO_USER: "davloom",
      RCLONE_CONFIG_RO_PASS: spawnSync("rclone", ["obscure", davloom.readOnlyKey], {
        encoding: "utf8",
      }).stdout.trim(),
    };
    ok("mkdir", "dav:ro");
    const file = join(workdir, "ro.txt");
    writeFileSync(file, "x");
    ok("copy", file, "dav:ro");
    const list = spawnSync("rclone", ["--config", "/dev/null", "lsf", "ro:ro"], {
      env,
      encoding: "utf8",
    });
    expect(list.stdout).toBe("ro.txt\n");
    const upload = spawnSync(
      "rclone",
      [
        "--config",
        "/dev/null",
        "copyto",
        file,
        "ro:ro/new.txt",
        "--retries",
        "1",
        "--low-level-retries",
        "1",
      ],
      {
        env,
        encoding: "utf8",
      },
    );
    expect(upload.status).not.toBe(0);
  });
});
