import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  chmodSync,
  closeSync,
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDavloom, type Davloom } from "./davloom";
import {
  DEPLOYMENTS,
  eventually,
  has,
  mkcolServer,
  MOUNT,
  putServerFile,
  serverBytes,
  serverFile,
  serverHasFolder,
  serverLocks,
} from "./real-clients";

// davfs2, the Linux file system that mounts a WebDAV share through FUSE, against both deployments.
// Each case works through the mounted file system with Node's fs calls, in a folder of its own, and
// reads what the server holds over HTTP. Mounting needs root: the tests run mount.davfs directly as
// root, or through passwordless sudo as on GitHub's runners. A machine without davfs2, /dev/fuse or
// such sudo skips them.

const uid = process.getuid?.() ?? 0;
const gid = process.getgid?.() ?? 0;
const SUDO = uid === 0 ? [] : ["sudo", "-n"];
const canMount =
  has("mount.davfs") &&
  existsSync("/dev/fuse") &&
  (SUDO.length === 0 || spawnSync("sudo", ["-n", "true"]).status === 0);

const asRoot = (command: string, args: readonly string[], input?: string) => {
  const [program = command, ...rest] = [...SUDO, command, ...args];
  return spawnSync(program, rest, { input, encoding: "utf8", timeout: 120_000 });
};

interface Mounted {
  readonly root: string;
  unmount(): void;
}

/**
 * Mounts a WebDAV address with davfs2, which asks for the username and password on its input. Its
 * cache lives in a directory of the mount's own, which the unprivileged user davfs2 runs as can
 * write. Uploads start as soon as a file closes, and listings older than a second are read again,
 * so a case sees what another client changed.
 */
const mountDav = (url: string, key: string): Mounted => {
  const base = mkdtempSync(join(tmpdir(), "davloom-davfs2-"));
  chmodSync(base, 0o755);
  const cache = join(base, "cache");
  const root = join(base, "mnt");
  mkdirSync(cache);
  chmodSync(cache, 0o777);
  mkdirSync(root);
  const conf = join(base, "davfs2.conf");
  writeFileSync(
    conf,
    [
      "use_locks 1",
      "delay_upload 0",
      "dir_refresh 1",
      "file_refresh 1",
      `cache_dir ${cache}`,
      "connect_timeout 10",
      "read_timeout 30",
      "retry 1",
      "",
    ].join("\n"),
  );
  const options = `conf=${conf},uid=${uid},gid=${gid},file_mode=0644,dir_mode=0755`;
  const mounted = asRoot("mount.davfs", [url, root, "-o", options], `davloom\n${key}\n`);
  if (mounted.status !== 0) {
    rmSync(base, { recursive: true, force: true });
    throw new Error(`mount.davfs ${url} failed: ${mounted.stdout}${mounted.stderr}`);
  }
  return {
    root,
    unmount: () => {
      // umount.davfs waits until every upload in the cache has reached the server.
      const unmounted = asRoot("umount", [root]);
      if (unmounted.status !== 0) {
        throw new Error(`umount ${root} failed: ${unmounted.stdout}${unmounted.stderr}`);
      }
      rmSync(base, { recursive: true, force: true });
    },
  };
};

interface Context {
  readonly davloom: Davloom;
  /** The case's folder in the Mount. */
  readonly folder: string;
  /** The case's folder in the mounted file system. */
  readonly local: string;
  readonly mounted: Mounted;
}

interface Davfs2Case {
  readonly name: string;
  /** What the server holds before the case, written over HTTP; by default an empty folder. */
  readonly before?: (davloom: Davloom, folder: string) => Promise<void>;
  readonly run: (context: Context) => Promise<void>;
}

const BIG = Uint8Array.from({ length: 5 * 1024 * 1024 + 11 }, (_, i) => (i * 17 + 3) % 256);
const UNICODE = "a b 文件 😀.txt";

const fileWith =
  (files: Readonly<Record<string, string>>, folders: readonly string[] = []) =>
  async (davloom: Davloom, folder: string) => {
    await mkcolServer(davloom, folder);
    for (const sub of folders) await mkcolServer(davloom, `${folder}/${sub}`);
    for (const [name, body] of Object.entries(files)) {
      expect(await putServerFile(davloom, `${folder}/${name}`, body)).toBe(201);
    }
  };

/** Waits until the mounted file system shows a path that another client made. */
const appears = (path: string) => eventually(async () => existsSync(path), `${path} to appear`);

const arrives = (davloom: Davloom, path: string, body: string) =>
  eventually(async () => (await serverFile(davloom, path)) === body, `${path} to reach the server`);

const leaves = (davloom: Davloom, path: string) =>
  eventually(async () => (await serverFile(davloom, path)) === null, `${path} to leave the server`);

const CASES: readonly Davfs2Case[] = [
  {
    name: "writing a new file stores it on the server",
    run: async ({ davloom, folder, local }) => {
      writeFileSync(join(local, "new.txt"), "written through davfs2\n");
      await arrives(davloom, `${folder}/new.txt`, "written through davfs2\n");
    },
  },
  {
    name: "a file of 5 MB reaches the server unchanged",
    run: async ({ davloom, folder, local }) => {
      writeFileSync(join(local, "big.bin"), BIG);
      await eventually(
        async () => (await serverBytes(davloom, `${folder}/big.bin`))?.length === BIG.length,
        "big.bin to reach the server",
      );
      expect(await serverBytes(davloom, `${folder}/big.bin`)).toEqual(BIG);
    },
  },
  {
    name: "an empty file is stored empty",
    run: async ({ davloom, folder, local }) => {
      writeFileSync(join(local, "empty"), "");
      await arrives(davloom, `${folder}/empty`, "");
    },
  },
  {
    name: "reading a file another client stored returns its bytes",
    before: fileWith({ "remote.txt": "stored over HTTP" }),
    run: async ({ local }) => {
      await appears(join(local, "remote.txt"));
      expect(readFileSync(join(local, "remote.txt"), "utf8")).toBe("stored over HTTP");
    },
  },
  {
    name: "stat reports a file's size and that a folder is one",
    before: fileWith({ "sized.txt": "12345" }, ["sub"]),
    run: async ({ local }) => {
      await appears(join(local, "sized.txt"));
      expect(statSync(join(local, "sized.txt")).size).toBe(5);
      expect(statSync(join(local, "sized.txt")).isFile()).toBe(true);
      expect(statSync(join(local, "sub")).isDirectory()).toBe(true);
    },
  },
  {
    name: "mkdir makes a folder on the server",
    run: async ({ davloom, folder, local }) => {
      mkdirSync(join(local, "made"));
      await eventually(() => serverHasFolder(davloom, `${folder}/made`), "the folder");
    },
  },
  {
    name: "mkdir -p makes nested folders on the server",
    run: async ({ davloom, folder, local }) => {
      mkdirSync(join(local, "a", "b", "c"), { recursive: true });
      await eventually(() => serverHasFolder(davloom, `${folder}/a/b/c`), "the nested folder");
    },
  },
  {
    name: "renaming a file moves it on the server",
    before: fileWith({ "old.txt": "moved" }),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "old.txt"));
      renameSync(join(local, "old.txt"), join(local, "new.txt"));
      await arrives(davloom, `${folder}/new.txt`, "moved");
      await leaves(davloom, `${folder}/old.txt`);
    },
  },
  {
    name: "renaming a folder moves what it holds",
    before: async (davloom, folder) => {
      await fileWith({}, ["from"])(davloom, folder);
      await putServerFile(davloom, `${folder}/from/inside.txt`, "inside");
    },
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "from"));
      renameSync(join(local, "from"), join(local, "to"));
      await arrives(davloom, `${folder}/to/inside.txt`, "inside");
      expect(await serverHasFolder(davloom, `${folder}/from`)).toBe(false);
    },
  },
  {
    name: "overwriting a file replaces it on the server",
    before: fileWith({ "same.txt": "the old content, longer than the new" }),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "same.txt"));
      writeFileSync(join(local, "same.txt"), "new");
      await arrives(davloom, `${folder}/same.txt`, "new");
    },
  },
  {
    name: "appending to a file adds to it on the server",
    before: fileWith({ "log.txt": "one\n" }),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "log.txt"));
      appendFileSync(join(local, "log.txt"), "two\n");
      await arrives(davloom, `${folder}/log.txt`, "one\ntwo\n");
    },
  },
  {
    name: "copying a file in the mount stores both",
    before: fileWith({ "orig.txt": "copied" }),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "orig.txt"));
      copyFileSync(join(local, "orig.txt"), join(local, "dup.txt"));
      await arrives(davloom, `${folder}/dup.txt`, "copied");
      expect(await serverFile(davloom, `${folder}/orig.txt`)).toBe("copied");
    },
  },
  {
    name: "unlinking a file deletes it on the server",
    before: fileWith({ "gone.txt": "x", "kept.txt": "y" }),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "gone.txt"));
      unlinkSync(join(local, "gone.txt"));
      await leaves(davloom, `${folder}/gone.txt`);
      expect(await serverFile(davloom, `${folder}/kept.txt`)).toBe("y");
    },
  },
  {
    name: "rmdir removes an empty folder on the server",
    before: fileWith({}, ["empty-dir"]),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "empty-dir"));
      rmdirSync(join(local, "empty-dir"));
      await eventually(
        async () => !(await serverHasFolder(davloom, `${folder}/empty-dir`)),
        "the folder to leave the server",
      );
    },
  },
  {
    name: "names with spaces and Unicode keep their names on the server",
    run: async ({ davloom, folder, local }) => {
      writeFileSync(join(local, UNICODE), "unicode");
      await arrives(davloom, `${folder}/${UNICODE}`, "unicode");
    },
  },
  {
    name: "readdir lists the files and folders another client made",
    before: fileWith({ "a.txt": "a", [UNICODE]: "u" }, ["sub"]),
    run: async ({ local }) => {
      await appears(join(local, "sub"));
      expect(readdirSync(local).toSorted()).toEqual(["a.txt", "sub", UNICODE].toSorted());
    },
  },
  {
    name: "rm -r removes a folder with what it holds",
    before: async (davloom, folder) => {
      await fileWith({}, ["tree", "tree/deep"])(davloom, folder);
      await putServerFile(davloom, `${folder}/tree/deep/leaf.txt`, "leaf");
    },
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "tree"));
      rmSync(join(local, "tree"), { recursive: true });
      await eventually(
        async () => !(await serverHasFolder(davloom, `${folder}/tree`)),
        "the tree to leave the server",
      );
    },
  },
  {
    name: "a file open for writing is locked against other clients until it closes",
    before: fileWith({ "held.txt": "held" }),
    run: async ({ davloom, folder, local }) => {
      await appears(join(local, "held.txt"));
      const descriptor = openSync(join(local, "held.txt"), "r+");
      try {
        await eventually(
          async () => /activelock/.test(await serverLocks(davloom, `${folder}/held.txt`)),
          "davfs2 to lock held.txt",
        );
        expect(await putServerFile(davloom, `${folder}/held.txt`, "intruder")).toBe(423);
        writeSync(descriptor, "HELD");
      } finally {
        closeSync(descriptor);
      }
      await arrives(davloom, `${folder}/held.txt`, "HELD");
      await eventually(
        async () => !/activelock/.test(await serverLocks(davloom, `${folder}/held.txt`)),
        "davfs2 to unlock held.txt",
      );
    },
  },
  {
    name: "unmounting uploads what is still waiting",
    run: async ({ davloom, folder, local, mounted }) => {
      for (const index of [1, 2, 3]) writeFileSync(join(local, `last-${index}.txt`), `${index}`);
      mounted.unmount();
      for (const index of [1, 2, 3]) {
        expect(await serverFile(davloom, `${folder}/last-${index}.txt`)).toBe(`${index}`);
      }
    },
  },
];

describe.each(DEPLOYMENTS)("davfs2 on %s", (_name, start, skip) => {
  let davloom: Davloom;
  let mounted: Mounted | undefined;
  let isMounted = false;

  beforeAll(async () => {
    if (skip || !canMount) return;
    davloom = await startDavloom(start);
    mounted = mountDav(`${davloom.server.url}/dav/${MOUNT}/`, davloom.readWriteKey);
    isMounted = true;
  }, 180_000);
  afterAll(async () => {
    if (mounted && isMounted) mounted.unmount();
    await davloom?.server.stop();
  }, 120_000);

  describe.skipIf(skip || !canMount)("a read-write mount", () => {
    it.each(CASES.map((c, index) => [c.name, c, index] as const))(
      "%s",
      { timeout: 90_000 },
      async (_label, { before, run }, index) => {
        if (!mounted || !isMounted) throw new Error("the mount is gone");
        const folder = `davfs2-${index}`;
        const local = join(mounted.root, folder);
        if (before) {
          await before(davloom, folder);
          await appears(local);
        } else {
          mkdirSync(local);
        }
        const current = mounted;
        await run({
          davloom,
          folder,
          local,
          mounted: {
            root: current.root,
            unmount: () => {
              isMounted = false;
              current.unmount();
            },
          },
        });
      },
    );
  });

  describe.skipIf(skip || !canMount)("a Read Only mount", () => {
    it("reads what is stored and refuses every change", { timeout: 120_000 }, async () => {
      await fileWith({ "public.txt": "readable" })(davloom, "davfs2-read-only");
      const readOnly = mountDav(`${davloom.server.url}/dav/${MOUNT}/`, davloom.readOnlyKey);
      try {
        const local = join(readOnly.root, "davfs2-read-only");
        await appears(join(local, "public.txt"));
        expect(readFileSync(join(local, "public.txt"), "utf8")).toBe("readable");
        expect(() => mkdirSync(join(local, "refused"))).toThrow();
        expect(() => unlinkSync(join(local, "public.txt"))).toThrow();
        try {
          writeFileSync(join(local, "refused.txt"), "refused");
        } catch {
          // davfs2 may refuse at once or only when the upload fails; the server decides below.
        }
      } finally {
        readOnly.unmount();
      }
      expect(await serverFile(davloom, "davfs2-read-only/refused.txt")).toBeNull();
      expect(await serverHasFolder(davloom, "davfs2-read-only/refused")).toBe(false);
      expect(await serverFile(davloom, "davfs2-read-only/public.txt")).toBe("readable");
    });
  });
});
