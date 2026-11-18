import * as fc from "fast-check";
import { describe, expect, it } from "vitest";
import type { Entry } from "../sample-data/data";
import {
  createFolderIn,
  destinationsFor,
  folderIn,
  foldersOf,
  nameProblem,
  normalizePath,
  putFileIn,
  removeIn,
  renameIn,
  splitPath,
  transferIn,
  type Outcome,
  type Trees,
} from "./tree";

// The laws below are the ones these stand-ins share with the server's rules (design.md
// Decision 2): the Phase 1 namespace model, Phase 2 name validation and Phase 2 COPY and MOVE.

const AT = "2026-11-16T15:30:00.000Z";
const MOUNTS = ["m", "n"];
// "ab" starts with "a", so a path check that forgets the slash shows.
const NAMES = ["a", "b", "c", "ab"];
// Names a user could type, the valid ones and the ones the rules refuse.
const TYPED = [...NAMES, "", " ", ".", "..", "a/b", " a "];
const PATHS = ["/m", "/m/a", "/m/b", "/m/ab", "/m/a/b", "/m/b/a", "/n", "/n/a", "/n/c", "/x", "/"];

const fileNamed = (name: string): Entry => ({ name, kind: "file", sizeBytes: 1, modifiedAt: AT });

// Files and folders, with names unique within each folder, a few levels deep.
const tree = fc.letrec<{ entries: Entry[]; entry: Entry }>((tie) => ({
  entries: fc.uniqueArray(tie("entry"), { selector: (entry) => entry.name, maxLength: 3 }),
  entry: fc.oneof(
    { maxDepth: 3 },
    fc.constantFrom(...NAMES).map(fileNamed),
    fc
      .record({ name: fc.constantFrom(...NAMES), children: tie("entries") })
      .map(({ name, children }): Entry => ({
        name,
        kind: "folder",
        sizeBytes: 0,
        modifiedAt: AT,
        children,
      })),
  ),
}));
const trees: fc.Arbitrary<Trees> = fc.record({ m: tree.entries, n: tree.entries });

const names = fc.uniqueArray(fc.constantFrom(...NAMES), { minLength: 1, maxLength: 3 });
const operation = fc.oneof(
  fc.record({ path: fc.constantFrom(...PATHS), name: fc.constantFrom(...TYPED) }).map(
    ({ path, name }) =>
      (t: Trees) =>
        createFolderIn(t, MOUNTS, path, name, AT),
  ),
  fc
    .record({
      path: fc.constantFrom(...PATHS),
      from: fc.constantFrom(...NAMES),
      to: fc.constantFrom(...TYPED),
    })
    .map(
      ({ path, from, to }) =>
        (t: Trees) =>
          renameIn(t, MOUNTS, path, from, to, AT),
    ),
  fc.record({ path: fc.constantFrom(...PATHS), names }).map(
    ({ path, names: some }) =>
      (t: Trees) =>
        removeIn(t, MOUNTS, path, new Set(some)),
  ),
  fc
    .record({
      transfer: fc.constantFrom("move" as const, "copy" as const),
      from: fc.constantFrom(...PATHS),
      names,
      to: fc.constantFrom(...PATHS),
    })
    .map(
      ({ transfer, from, names: some, to }) =>
        (t: Trees) =>
          transferIn(t, MOUNTS, transfer, from, new Set(some), to, AT),
    ),
  fc.record({ path: fc.constantFrom(...PATHS), name: fc.constantFrom(...NAMES) }).map(
    ({ path, name }) =>
      (t: Trees) =>
        putFileIn(t, MOUNTS, path, fileNamed(name)),
  ),
);

const apply = (start: Trees, steps: readonly ((t: Trees) => Outcome)[]): Trees[] => {
  const states = [start];
  for (const step of steps) {
    const outcome = step(states.at(-1) ?? start);
    if (outcome.problem === undefined) {
      states.push(outcome.trees);
    }
  }
  return states;
};

// Every folder of every mount, mount roots included, with its entries.
const everyFolder = (t: Trees): Entry[][] => {
  const walk = (entries: Entry[]): Entry[][] => [
    entries,
    ...entries.flatMap((entry) => (entry.kind === "folder" ? walk(entry.children ?? []) : [])),
  ];
  return MOUNTS.flatMap((mount) => walk(t[mount] ?? []));
};

// Every item of every mount as its full path, such as "/m/a/b".
const itemsOf = (t: Trees): string[] => {
  const walk = (entries: readonly Entry[], prefix: string): string[] =>
    entries.flatMap((entry) => [
      `${prefix}/${entry.name}`,
      ...(entry.kind === "folder" ? walk(entry.children ?? [], `${prefix}/${entry.name}`) : []),
    ]);
  return MOUNTS.flatMap((mount) => walk(t[mount] ?? [], `/${mount}`)).toSorted();
};

const isWithin = (folder: string, source: string): boolean =>
  folder === source || folder.startsWith(`${source}/`);

// A transfer the page would offer: items that are in a folder, to a destination the page lists.
const offeredTransfer = trees.chain((start) => {
  const sources = foldersOf(start, MOUNTS).filter(
    (path) => (folderIn(start, MOUNTS, path) ?? []).length > 0,
  );
  if (sources.length === 0) {
    return fc.constant(undefined);
  }
  return fc.constantFrom(...sources).chain((from) =>
    fc
      .subarray(
        (folderIn(start, MOUNTS, from) ?? []).map(({ name }) => name),
        { minLength: 1 },
      )
      .chain((some) => {
        const offered = destinationsFor(start, MOUNTS, from, some);
        return offered.length === 0
          ? fc.constant(undefined)
          : fc.constantFrom(...offered).map((to) => ({ start, from, some, to }));
      }),
  );
});

type TransferCase = { start: Trees; from: string; some: string[]; to: string };

// Any transfer, not only the ones the page offers. Most come from folders the trees hold and name
// items the folder holds, so that each way a transfer can be refused comes up in a run; the rest
// take any path and any names.
const anyTransfer = trees.chain((start) => {
  const path = fc.oneof(
    { weight: 4, arbitrary: fc.constantFrom(...foldersOf(start, MOUNTS)) },
    { weight: 1, arbitrary: fc.constantFrom(...PATHS) },
  );
  return fc.record({ from: path, to: path }).chain(({ from, to }) => {
    const held = (folderIn(start, MOUNTS, from) ?? []).map(({ name }) => name);
    const some =
      held.length === 0
        ? names
        : fc.oneof(
            { weight: 3, arbitrary: fc.subarray(held, { minLength: 1 }) },
            { weight: 1, arbitrary: names },
          );
    return some.map((picked): TransferCase => ({ start, from, some: picked, to }));
  });
});

const REFUSALS = ["no source", "no destination", "name missing", "into itself", "name taken"];

// The first of the rules a transfer breaks, or undefined when it breaks none.
const refusalOf = ({ start, from, some, to }: TransferCase): string | undefined => {
  const source = folderIn(start, MOUNTS, from);
  const destination = folderIn(start, MOUNTS, to);
  if (source === undefined) {
    return "no source";
  }
  if (destination === undefined) {
    return "no destination";
  }
  if (!some.every((name) => source.some((entry) => entry.name === name))) {
    return "name missing";
  }
  if (some.some((name) => isWithin(to, `${from}/${name}`))) {
    return "into itself";
  }
  return destination.some((entry) => some.includes(entry.name)) ? "name taken" : undefined;
};

// Generated transfers often hit a name the destination already holds. The two transfer properties
// run more cases, count the transfers that succeeded with a folder that has contents, and fail
// when there are too few for the run to have checked the law. A run of 300 cases counts about 100.
const TRANSFER_RUNS = { numRuns: 300 };
const ENOUGH_FILLED_FOLDERS = 30;

describe("namespace model", () => {
  it("names stay unique within every folder, whatever the user does", () => {
    fc.assert(
      fc.property(trees, fc.array(operation, { maxLength: 8 }), (start, steps) => {
        for (const state of apply(start, steps)) {
          for (const entries of everyFolder(state)) {
            expect(new Set(entries.map((entry) => entry.name)).size).toBe(entries.length);
          }
        }
      }),
    );
  });

  it("a folder never goes inside itself, and is never offered as its own destination", () => {
    fc.assert(
      fc.property(trees, fc.nat(), fc.nat(), (start, pick, pickInside) => {
        const nested = foldersOf(start, MOUNTS).filter((path) => splitPath(path).length > 1);
        const folder = nested[pick % Math.max(nested.length, 1)];
        if (folder === undefined) {
          return;
        }
        const parts = splitPath(folder);
        const parent = `/${parts.slice(0, -1).join("/")}`;
        const name = parts.at(-1) ?? "";
        const inside = foldersOf(start, MOUNTS).filter((path) => isWithin(path, folder));
        const target = inside[pickInside % inside.length] ?? folder;

        for (const transfer of ["move", "copy"] as const) {
          expect(
            transferIn(start, MOUNTS, transfer, parent, new Set([name]), target, AT).problem,
          ).toBeDefined();
        }
        expect(
          destinationsFor(start, MOUNTS, parent, [name]).some((path) => isWithin(path, folder)),
        ).toBe(false);
        // The folder the item is in already holds it, so it is no destination either.
        expect(destinationsFor(start, MOUNTS, parent, [name])).not.toContain(parent);
      }),
    );
  });

  it("a move keeps every item, and a copy adds exactly what it copies", () => {
    let filledFolders = 0;
    fc.assert(
      fc.property(offeredTransfer, (offer) => {
        if (offer === undefined) {
          return;
        }
        const { start, from, some, to } = offer;
        const before = itemsOf(start);
        const isMoving = (item: string) => some.some((name) => isWithin(item, `${from}/${name}`));
        // An item under one of the named items, at the place the transfer puts it.
        const arriving = (item: string) => `${to}${item.slice(from.length)}`;

        for (const transfer of ["move", "copy"] as const) {
          const outcome = transferIn(start, MOUNTS, transfer, from, new Set(some), to, AT);
          if (outcome.problem === undefined) {
            const expected =
              transfer === "move"
                ? before.map((item) => (isMoving(item) ? arriving(item) : item))
                : [...before, ...before.filter(isMoving).map(arriving)];
            expect(itemsOf(outcome.trees)).toEqual(expected.toSorted());
            if (before.filter(isMoving).length > some.length) {
              filledFolders += 1;
            }
          }
        }
      }),
      TRANSFER_RUNS,
    );
    expect(filledFolders).toBeGreaterThanOrEqual(ENOUGH_FILLED_FOLDERS);
  });

  it("a transfer brings every named item, or refuses when the destination holds one of them", () => {
    let filledFolders = 0;
    fc.assert(
      fc.property(offeredTransfer, (offer) => {
        if (offer === undefined) {
          return;
        }
        const { start, from, some, to } = offer;
        const isTaken = (folderIn(start, MOUNTS, to) ?? []).some((entry) =>
          some.includes(entry.name),
        );
        for (const transfer of ["move", "copy"] as const) {
          const outcome = transferIn(start, MOUNTS, transfer, from, new Set(some), to, AT);
          if (isTaken) {
            expect(outcome.problem).toBeDefined();
          } else if (outcome.problem === undefined) {
            const namesIn = (path: string) =>
              (folderIn(outcome.trees, MOUNTS, path) ?? []).map(({ name }) => name);
            expect(namesIn(to)).toEqual(expect.arrayContaining(some));
            expect(
              namesIn(from)
                .filter((name) => some.includes(name))
                .toSorted(),
            ).toEqual(transfer === "move" ? [] : some.toSorted());
            if (
              (folderIn(start, MOUNTS, from) ?? []).some(
                (entry) => some.includes(entry.name) && (entry.children ?? []).length > 0,
              )
            ) {
              filledFolders += 1;
            }
          } else {
            expect.unreachable(outcome.problem);
          }
        }
      }),
      TRANSFER_RUNS,
    );
    expect(filledFolders).toBeGreaterThanOrEqual(ENOUGH_FILLED_FOLDERS);
  });

  it("a transfer succeeds exactly when its folder holds every name and nothing is in the way", () => {
    const seen = new Set<string>();
    fc.assert(
      fc.property(
        anyTransfer,
        fc.constantFrom("move" as const, "copy" as const),
        (offer, transfer) => {
          const refusal = refusalOf(offer);
          seen.add(refusal ?? "allowed");
          const { start, from, some, to } = offer;
          const outcome = transferIn(start, MOUNTS, transfer, from, new Set(some), to, AT);
          expect(outcome.problem === undefined).toBe(refusal === undefined);
        },
      ),
      TRANSFER_RUNS,
    );
    // The run checked the law only if it met each refusal and a transfer that goes ahead.
    expect([...seen].toSorted()).toEqual([...REFUSALS, "allowed"].toSorted());
  });

  it("a new or renamed item cannot take a name its folder holds", () => {
    const start: Trees = { m: [fileNamed("a"), fileNamed("b")] };
    expect(createFolderIn(start, MOUNTS, "/m", "b", AT).problem).toBe(
      "Something with this name is already here.",
    );
    expect(renameIn(start, MOUNTS, "/m", "a", "b", AT).problem).toBe(
      "Something with this name is already here.",
    );
    expect(renameIn(start, MOUNTS, "/m", "a", " b ", AT).problem).toBeDefined();
    // Keeping an item's own name takes no other item's.
    expect(renameIn(start, MOUNTS, "/m", "a", "a", AT).problem).toBeUndefined();
  });

  it("a new or renamed item is stored under its name without the spaces around it", () => {
    const start: Trees = { m: [fileNamed("a")] };
    const created = createFolderIn(start, MOUNTS, "/m", " c ", AT);
    const renamed = renameIn(start, MOUNTS, "/m", "a", " d ", AT);
    if (created.problem !== undefined || renamed.problem !== undefined) {
      expect.unreachable(created.problem ?? renamed.problem);
    }
    expect(folderIn(created.trees, MOUNTS, "/m")?.map(({ name }) => name)).toEqual(["a", "c"]);
    expect(folderIn(renamed.trees, MOUNTS, "/m")?.map(({ name }) => name)).toEqual(["d"]);
  });

  it("a folder whose name starts with another's name is not inside that folder", () => {
    const folderNamed = (name: string): Entry => ({
      name,
      kind: "folder",
      sizeBytes: 0,
      modifiedAt: AT,
      children: [],
    });
    const start: Trees = { m: [folderNamed("a"), folderNamed("ab")] };
    expect(destinationsFor(start, MOUNTS, "/m", ["a"])).toContain("/m/ab");
    expect(
      transferIn(start, MOUNTS, "move", "/m", new Set(["a"]), "/m/ab", AT).problem,
    ).toBeUndefined();
  });

  it.each(["constructor", "__proto__", "toString", "hasOwnProperty"])(
    "a mount named %j has a tree of its own",
    (mount) => {
      const mounts = [mount];
      expect(folderIn({}, mounts, `/${mount}`)).toEqual([]);
      expect(foldersOf({}, mounts)).toEqual([`/${mount}`]);
      const outcome = createFolderIn({}, mounts, `/${mount}`, "Receipts", AT);
      if (outcome.problem !== undefined) {
        expect.unreachable(outcome.problem);
      }
      expect(foldersOf(outcome.trees, mounts)).toEqual([`/${mount}`, `/${mount}/Receipts`]);
      expect(destinationsFor(outcome.trees, mounts, `/${mount}`, ["Receipts"])).toEqual([]);
    },
  );

  it("removing takes away the named items and nothing else", () => {
    fc.assert(
      fc.property(trees, fc.constantFrom(...PATHS), names, (start, path, some) => {
        const outcome = removeIn(start, MOUNTS, path, new Set(some));
        if (folderIn(start, MOUNTS, path) === undefined) {
          expect(outcome.problem).toBeDefined();
        } else if (outcome.problem === undefined) {
          // The whole trees, so that an item removed anywhere else is caught too.
          expect(itemsOf(outcome.trees)).toEqual(
            itemsOf(start).filter(
              (item) => !some.some((name) => isWithin(item, `${path}/${name}`)),
            ),
          );
        } else {
          expect.unreachable(outcome.problem);
        }
      }),
    );
  });

  it("storing a file replaces a file of that name, and never a folder", () => {
    fc.assert(
      fc.property(
        trees,
        fc.constantFrom(...PATHS),
        fc.constantFrom(...NAMES),
        (start, path, name) => {
          const before = folderIn(start, MOUNTS, path);
          const outcome = putFileIn(start, MOUNTS, path, fileNamed(name));
          const others = (entries: readonly Entry[]) =>
            entries.filter((entry) => entry.name !== name);
          if (
            before === undefined ||
            before.some((entry) => entry.kind === "folder" && entry.name === name)
          ) {
            expect(outcome.problem).toBeDefined();
          } else if (outcome.problem === undefined) {
            const after = folderIn(outcome.trees, MOUNTS, path) ?? [];
            expect(after.filter((entry) => entry.name === name)).toEqual([fileNamed(name)]);
            expect(others(after)).toEqual(others(before));
          } else {
            expect.unreachable(outcome.problem);
          }
        },
      ),
    );
  });

  it("nothing outside the mounts exists", () => {
    // The top level, and any path that starts with a name that is not a mount, even a name with
    // a tree of its own.
    const outside = fc.oneof(
      fc.constant("/"),
      fc
        .tuple(
          fc.constantFrom("x", ...NAMES),
          fc.array(fc.constantFrom(...NAMES), { maxLength: 2 }),
        )
        .map(([first, rest]) => `/${[first, ...rest].join("/")}`),
    );
    fc.assert(
      fc.property(trees, tree.entries, outside, (inside, stray, path) => {
        const all = { ...inside, x: stray };
        expect(folderIn(all, MOUNTS, path)).toBeUndefined();
        expect(createFolderIn(all, MOUNTS, path, "a", AT).problem).toBeDefined();
        expect(putFileIn(all, MOUNTS, path, fileNamed("a")).problem).toBeDefined();
      }),
    );
    // A mount added during the visit has no tree yet, and is an empty folder.
    expect(folderIn({}, MOUNTS, "/n")).toEqual([]);
  });
});

describe("name validation", () => {
  const siblings = [fileNamed("taken")];
  it.each([
    ["report.pdf", undefined],
    ["  spaced  ", undefined],
    ["", "Enter a name."],
    ["   ", "Enter a name."],
    ["a/b", "Names cannot contain a slash."],
    [".", "Choose another name."],
    ["..", "Choose another name."],
    ["taken", "Something with this name is already here."],
    [" taken ", "Something with this name is already here."],
  ])("%j gives %j", (name, problem) => {
    expect(nameProblem(name, siblings)).toBe(problem);
  });

  it("an accepted name is one non-empty segment that no sibling has", () => {
    fc.assert(
      fc.property(
        fc.string({ unit: fc.constantFrom("a", ".", "/", " "), maxLength: 5 }),
        fc.uniqueArray(fc.constantFrom(...NAMES, "a.", ".a"), { maxLength: 3 }),
        (name, taken) => {
          if (nameProblem(name, taken.map(fileNamed)) === undefined) {
            const trimmed = name.trim();
            expect(trimmed).not.toBe("");
            expect(trimmed.includes("/")).toBe(false);
            expect([".", ".."]).not.toContain(trimmed);
            expect(taken).not.toContain(trimmed);
          }
        },
      ),
    );
  });
});

describe("path normalization", () => {
  it.each([
    ["/", "/"],
    ["", "/"],
    ["/documents/", "/documents"],
    ["//documents//Drafts", "/documents/Drafts"],
    ["documents", "/documents"],
  ])("%j becomes %j", (path, normal) => {
    expect(normalizePath(path)).toBe(normal);
  });

  it("normalizing twice changes nothing, and the result has no empty segment", () => {
    fc.assert(
      fc.property(fc.string({ unit: fc.constantFrom("/", "a", "."), maxLength: 10 }), (path) => {
        const normal = normalizePath(path);
        expect(normalizePath(normal)).toBe(normal);
        expect(normal.startsWith("/")).toBe(true);
        expect(normal.includes("//")).toBe(false);
        expect(normal === "/" || !normal.endsWith("/")).toBe(true);
      }),
    );
  });
});
