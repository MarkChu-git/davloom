import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startDavloom, type Davloom } from "./davloom";
import {
  DEPLOYMENTS,
  davPathOf,
  has,
  mkcolServer,
  MOUNT,
  putServerFile,
  serverBytes,
  serverFile,
  serverHasFolder,
  serverLocks,
} from "./real-clients";

// cadaver, the command-line WebDAV client built on neon, in scripted sessions against both
// deployments. Each case runs one cadaver session in a folder of its own and then reads what the
// server holds over HTTP, so the client's own report is never the oracle. CI installs cadaver; a
// machine without it skips these tests.

interface Session {
  readonly davloom: Davloom;
  /** The case's folder in the Mount. */
  readonly folder: string;
  /** The local directory cadaver runs in. */
  readonly local: string;
  /** What cadaver printed. */
  readonly output: string;
}

interface CadaverCase {
  readonly name: string;
  /** Files in the local directory before the session. */
  readonly files?: Readonly<Record<string, string | Uint8Array>>;
  /** What the server holds before the session, written over HTTP. */
  readonly before?: (davloom: Davloom, folder: string) => Promise<void>;
  /** The session's commands; cadaver starts at the Mount's root. */
  readonly commands: (folder: string) => readonly string[];
  /** Whether the session signs in with the Read Only key. */
  readonly readOnly?: boolean;
  /** How many commands are to fail; by default none. */
  readonly failures?: number;
  readonly check: (session: Session) => Promise<void>;
}

const BINARY = Uint8Array.from({ length: 2 * 1024 * 1024 + 3 }, (_, i) => (i * 31 + 7) % 256);
const UNICODE = "a b 文件 😀.txt";

/** Stores files in a new folder of the Mount over HTTP. */
const folderWith =
  (files: Readonly<Record<string, string>>, folders: readonly string[] = []) =>
  async (davloom: Davloom, folder: string) => {
    await mkcolServer(davloom, folder);
    for (const sub of folders) await mkcolServer(davloom, `${folder}/${sub}`);
    for (const [name, body] of Object.entries(files)) {
      expect(await putServerFile(davloom, `${folder}/${name}`, body)).toBe(201);
    }
  };

const CASES: readonly CadaverCase[] = [
  {
    name: "mkcol makes a folder",
    commands: (folder) => [`mkcol ${folder}`],
    check: async ({ davloom, folder }) => {
      expect(await serverHasFolder(davloom, folder)).toBe(true);
    },
  },
  {
    name: "mkcol makes nested folders one at a time",
    commands: (folder) => [`mkcol ${folder}`, `mkcol ${folder}/a`, `mkcol ${folder}/a/b`],
    check: async ({ davloom, folder }) => {
      expect(await serverHasFolder(davloom, `${folder}/a/b`)).toBe(true);
    },
  },
  {
    name: "put uploads a text file",
    files: { "note.txt": "uploaded by cadaver\n" },
    commands: (folder) => [`mkcol ${folder}`, `cd ${folder}`, "put note.txt"],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/note.txt`)).toBe("uploaded by cadaver\n");
    },
  },
  {
    name: "put uploads a binary file of 2 MB unchanged",
    files: { "blob.bin": BINARY },
    commands: (folder) => [`mkcol ${folder}`, `put blob.bin ${folder}/blob.bin`],
    check: async ({ davloom, folder }) => {
      expect(await serverBytes(davloom, `${folder}/blob.bin`)).toEqual(BINARY);
    },
  },
  {
    name: "put uploads an empty file",
    files: { empty: "" },
    commands: (folder) => [`mkcol ${folder}`, `put empty ${folder}/empty`],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/empty`)).toBe("");
    },
  },
  {
    name: "put replaces a file another client stored",
    before: folderWith({ "same.txt": "old" }),
    files: { "same.txt": "new from cadaver" },
    commands: (folder) => [`cd ${folder}`, "put same.txt"],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/same.txt`)).toBe("new from cadaver");
    },
  },
  {
    name: "put keeps spaces and Unicode in a name",
    files: { [UNICODE]: "unicode" },
    commands: (folder) => [`mkcol ${folder}`, `cd ${folder}`, `put "${UNICODE}"`],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/${UNICODE}`)).toBe("unicode");
    },
  },
  {
    name: "mput uploads several files",
    files: { "one.txt": "1", "two.txt": "2", "three.txt": "3" },
    commands: (folder) => [`mkcol ${folder}`, `cd ${folder}`, "mput one.txt two.txt three.txt"],
    check: async ({ davloom, folder }) => {
      for (const [name, body] of [
        ["one.txt", "1"],
        ["two.txt", "2"],
        ["three.txt", "3"],
      ] as const) {
        expect(await serverFile(davloom, `${folder}/${name}`), name).toBe(body);
      }
    },
  },
  {
    name: "get downloads what another client stored",
    before: folderWith({ "remote.txt": "stored over HTTP" }),
    commands: (folder) => [`cd ${folder}`, "get remote.txt downloaded.txt"],
    check: async ({ local }) => {
      expect(readFileSync(join(local, "downloaded.txt"), "utf8")).toBe("stored over HTTP");
    },
  },
  {
    name: "get downloads a name with spaces and Unicode",
    before: folderWith({ [UNICODE]: "unicode down" }),
    commands: (folder) => [`cd ${folder}`, `get "${UNICODE}" plain.txt`],
    check: async ({ local }) => {
      expect(readFileSync(join(local, "plain.txt"), "utf8")).toBe("unicode down");
    },
  },
  {
    name: "mget downloads several files",
    before: folderWith({ "x.txt": "x", "y.txt": "y" }),
    commands: (folder) => [`cd ${folder}`, "mget x.txt y.txt"],
    check: async ({ local }) => {
      expect(readFileSync(join(local, "x.txt"), "utf8")).toBe("x");
      expect(readFileSync(join(local, "y.txt"), "utf8")).toBe("y");
    },
  },
  {
    name: "cat prints a file",
    before: folderWith({ "cat.txt": "printed by cat" }),
    commands: (folder) => [`cat ${folder}/cat.txt`],
    check: async ({ output }) => {
      expect(output).toContain("printed by cat");
    },
  },
  {
    name: "ls lists a folder's files and folders",
    before: folderWith({ "a.txt": "a", "b.txt": "bb" }, ["sub"]),
    commands: (folder) => [`ls ${folder}`],
    check: async ({ output }) => {
      expect(output).toMatch(/Listing collection .*: succeeded/);
      expect(output).toMatch(/a\.txt\s+1\s/);
      expect(output).toMatch(/b\.txt\s+2\s/);
      expect(output).toMatch(/Coll:\s+sub/);
    },
  },
  {
    name: "move renames a file",
    before: folderWith({ "old.txt": "moved" }),
    commands: (folder) => [`cd ${folder}`, "move old.txt new.txt"],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/old.txt`)).toBeNull();
      expect(await serverFile(davloom, `${folder}/new.txt`)).toBe("moved");
    },
  },
  {
    name: "move takes a folder with what it holds",
    before: async (davloom, folder) => {
      await folderWith({}, ["from"])(davloom, folder);
      await putServerFile(davloom, `${folder}/from/inside.txt`, "inside");
    },
    commands: (folder) => [`move ${folder}/from ${folder}/to`],
    check: async ({ davloom, folder }) => {
      expect(await serverHasFolder(davloom, `${folder}/from`)).toBe(false);
      expect(await serverFile(davloom, `${folder}/to/inside.txt`)).toBe("inside");
    },
  },
  {
    name: "move replaces a file that is in the way",
    before: folderWith({ "src.txt": "winner", "dst.txt": "loser" }),
    commands: (folder) => [`cd ${folder}`, "move src.txt dst.txt"],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/src.txt`)).toBeNull();
      expect(await serverFile(davloom, `${folder}/dst.txt`)).toBe("winner");
    },
  },
  {
    name: "copy duplicates a file",
    before: folderWith({ "orig.txt": "copied" }),
    commands: (folder) => [`cd ${folder}`, "copy orig.txt dup.txt"],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/orig.txt`)).toBe("copied");
      expect(await serverFile(davloom, `${folder}/dup.txt`)).toBe("copied");
    },
  },
  {
    name: "copy duplicates a folder with what it holds",
    before: async (davloom, folder) => {
      await folderWith({}, ["tree", "tree/deep"])(davloom, folder);
      await putServerFile(davloom, `${folder}/tree/deep/leaf.txt`, "leaf");
    },
    commands: (folder) => [`copy ${folder}/tree ${folder}/clone`],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/tree/deep/leaf.txt`)).toBe("leaf");
      expect(await serverFile(davloom, `${folder}/clone/deep/leaf.txt`)).toBe("leaf");
    },
  },
  {
    name: "delete removes a file",
    before: folderWith({ "gone.txt": "x", "kept.txt": "y" }),
    commands: (folder) => [`cd ${folder}`, "delete gone.txt"],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/gone.txt`)).toBeNull();
      expect(await serverFile(davloom, `${folder}/kept.txt`)).toBe("y");
    },
  },
  {
    name: "rmcol removes a folder with what it holds",
    before: async (davloom, folder) => {
      await folderWith({}, ["doomed"])(davloom, folder);
      await putServerFile(davloom, `${folder}/doomed/f.txt`, "f");
    },
    commands: (folder) => [`rmcol ${folder}/doomed`],
    check: async ({ davloom, folder }) => {
      expect(await serverHasFolder(davloom, `${folder}/doomed`)).toBe(false);
      expect(await serverFile(davloom, `${folder}/doomed/f.txt`)).toBeNull();
      expect(await serverHasFolder(davloom, folder)).toBe(true);
    },
  },
  {
    name: "lock and unlock: a put under the lock succeeds and no lock is left",
    before: folderWith({ "locked.txt": "before the lock" }),
    files: { "locked.txt": "written under the lock" },
    commands: (folder) => [
      `cd ${folder}`,
      "lock locked.txt",
      "put locked.txt",
      "unlock locked.txt",
    ],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/locked.txt`)).toBe("written under the lock");
      expect(await serverLocks(davloom, `${folder}/locked.txt`)).not.toMatch(/activelock/);
      expect(await putServerFile(davloom, `${folder}/locked.txt`, "after")).toBe(204);
    },
  },
  {
    name: "a lock cadaver leaves held refuses another client's write",
    before: folderWith({ "held.txt": "held" }),
    commands: (folder) => [`cd ${folder}`, "lock held.txt"],
    check: async ({ davloom, folder }) => {
      const locks = await serverLocks(davloom, `${folder}/held.txt`);
      expect(locks).toMatch(/activelock/);
      expect(locks).toMatch(/exclusive/);
      expect(await putServerFile(davloom, `${folder}/held.txt`, "intruder")).toBe(423);
      expect(await serverFile(davloom, `${folder}/held.txt`)).toBe("held");
    },
  },
  {
    name: "a lock on a folder refuses another client's new file in it",
    before: folderWith({}, ["locked"]),
    commands: (folder) => [`lock ${folder}/locked`],
    check: async ({ davloom, folder }) => {
      expect(await putServerFile(davloom, `${folder}/locked/new.txt`, "intruder")).toBe(423);
      expect(await serverFile(davloom, `${folder}/locked/new.txt`)).toBeNull();
    },
  },
  {
    name: "propset and propget keep a dead property",
    before: folderWith({ "prop.txt": "p" }),
    commands: (folder) => [`cd ${folder}`, "propset prop.txt color blue", "propget prop.txt color"],
    check: async ({ davloom, folder, output }) => {
      expect(output).toContain("Value of color is: blue");
      const response = await davloom.dav(davPathOf(`${folder}/prop.txt`), {
        method: "PROPFIND",
        headers: { depth: "0" },
      });
      expect(response.status).toBe(207);
      expect(await response.text()).toMatch(/color[^>]*>blue</);
    },
  },
  {
    name: "propdel removes a dead property",
    before: folderWith({ "unprop.txt": "p" }),
    commands: (folder) => [
      `cd ${folder}`,
      "propset unprop.txt flavor mint",
      "propdel unprop.txt flavor",
    ],
    check: async ({ davloom, folder }) => {
      const response = await davloom.dav(davPathOf(`${folder}/unprop.txt`), {
        method: "PROPFIND",
        headers: { depth: "0" },
      });
      expect(await response.text()).not.toContain("mint");
    },
  },
  {
    name: "with a Read Only key, get and ls work",
    before: folderWith({ "public.txt": "readable" }),
    readOnly: true,
    commands: (folder) => [`ls ${folder}`, `get ${folder}/public.txt public.txt`],
    check: async ({ local, output }) => {
      expect(output).toContain("public.txt");
      expect(readFileSync(join(local, "public.txt"), "utf8")).toBe("readable");
    },
  },
  {
    name: "with a Read Only key, put, mkcol, move, copy and delete are refused",
    before: folderWith({ "keep.txt": "kept" }),
    files: { "upload.txt": "refused" },
    readOnly: true,
    failures: 5,
    commands: (folder) => [
      `cd ${folder}`,
      "put upload.txt",
      "mkcol sub",
      "move keep.txt moved.txt",
      "copy keep.txt copied.txt",
      "delete keep.txt",
    ],
    check: async ({ davloom, folder }) => {
      expect(await serverFile(davloom, `${folder}/upload.txt`)).toBeNull();
      expect(await serverHasFolder(davloom, `${folder}/sub`)).toBe(false);
      expect(await serverFile(davloom, `${folder}/moved.txt`)).toBeNull();
      expect(await serverFile(davloom, `${folder}/copied.txt`)).toBeNull();
      expect(await serverFile(davloom, `${folder}/keep.txt`)).toBe("kept");
    },
  },
];

/** The lines in which cadaver reports a command that failed. */
const failedLines = (output: string) =>
  output.split("\n").filter((line) => /failed|not found|Could not/i.test(line));

let davloom: Davloom;
let workdir: string;

/** Runs one cadaver session in `local` with the commands, signed in through a .netrc. */
const cadaver = (local: string, commands: readonly string[], key: string) => {
  const home = join(local, ".home");
  mkdirSync(home, { recursive: true });
  const { hostname } = new URL(davloom.server.url);
  writeFileSync(join(home, ".netrc"), `machine ${hostname}\nlogin davloom\npassword ${key}\n`);
  chmodSync(join(home, ".netrc"), 0o600);
  const result = spawnSync("cadaver", ["-t", `${davloom.server.url}/dav/${MOUNT}/`], {
    cwd: local,
    env: { ...process.env, HOME: home },
    input: `${commands.join("\n")}\nquit\n`,
    encoding: "utf8",
    timeout: 60_000,
  });
  return `${result.stdout}${result.stderr}`;
};

describe.each(DEPLOYMENTS)("cadaver on %s", (_name, start, skip) => {
  const skipped = skip || !has("cadaver");

  beforeAll(async () => {
    if (skipped) return;
    davloom = await startDavloom(start);
    workdir = mkdtempSync(join(tmpdir(), "davloom-cadaver-"));
  }, 180_000);
  afterAll(async () => {
    await davloom?.server.stop();
    if (workdir) rmSync(workdir, { recursive: true, force: true });
  });

  describe.skipIf(skipped)("scripted sessions", () => {
    it.each(CASES.map((c, index) => [c.name, c, index] as const))(
      "%s",
      { timeout: 90_000 },
      async (_label, { files = {}, before, commands, readOnly, failures = 0, check }, index) => {
        const folder = `cadaver-${index}`;
        const local = join(workdir, folder);
        mkdirSync(local, { recursive: true });
        for (const [name, body] of Object.entries(files)) writeFileSync(join(local, name), body);
        await before?.(davloom, folder);

        const output = cadaver(
          local,
          commands(folder),
          readOnly ? davloom.readOnlyKey : davloom.readWriteKey,
        );

        expect(failedLines(output), output).toHaveLength(failures);
        await check({ davloom, folder, local, output });
      },
    );
  });
});
