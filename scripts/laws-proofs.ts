// Writes packages/laws/PROOF.bend: a proof by exhaustive case analysis for every law in LAWS.bend
// whose parameters all range over finite types, the constructors of which are listed below. Each
// leaf is `{==}`, so the checker evaluates both sides of the law for every combination. Laws over
// other types get their proofs by hand, in packages/laws/proofs/<law>.bend, which this script
// appends: `bun run laws:proofs`.
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const lawsDir = fileURLToPath(new URL("../packages/laws/", import.meta.url));

const FINITE: Record<string, string[]> = {
  Bool: ["False{}", "True{}"],
  "T.Node": ["T.Absent{}", "T.File{}", "T.Folder{}"],
  "P.Access": ["P.ReadOnly{}", "P.ReadWrite{}"],
  "P.Method": [
    "P.MOptions{}",
    "P.MGet{}",
    "P.MHead{}",
    "P.MPropfind{}",
    "P.MPut{}",
    "P.MMkcol{}",
    "P.MDelete{}",
    "P.MProppatch{}",
    "P.MCopy{}",
    "P.MMove{}",
    "P.MLock{}",
    "P.MUnlock{}",
    "P.MOther{}",
  ],
  "C.Check": ["C.Unset{}", "C.Holds{}", "C.Fails{}"],
};

const laws = await Bun.file(join(lawsDir, "LAWS.bend")).text();
const imports = laws.split("\n").filter((line) => line.startsWith("import ./src/"));
const out = ["import Base", "import ./LAWS.bend as L", ...imports, ""];
const manual = new Set<string>();
try {
  for (const file of await readdir(join(lawsDir, "proofs")))
    if (file.endsWith(".bend")) manual.add(file.slice(0, -5));
} catch {
  // No hand-written proofs yet.
}

const caseTree = (params: [string, string][], depth: number): string[] => {
  const pad = "  ".repeat(depth);
  const [first, ...rest] = params;
  if (!first) return [`${pad}{==}`];
  const constructors = FINITE[first[1]];
  if (!constructors) throw new Error(`no constructors listed for ${first[1]}`);
  return [
    `${pad}match ${first[0]}:`,
    ...constructors.flatMap((c) => [`${pad}  case ${c}:`, ...caseTree(rest, depth + 2)]),
  ];
};

const lawPattern = /^law (\w+):\n((?:  for .*\n)+)/gm;
for (const match of laws.matchAll(lawPattern)) {
  const name = match[1] ?? "";
  if (manual.has(name)) {
    out.push((await Bun.file(join(lawsDir, "proofs", `${name}.bend`)).text()).trimEnd(), "");
    continue;
  }
  const params = [...(match[2] ?? "").matchAll(/  for (\w+): (\S+)/g)].map(
    (m): [string, string] => [m[1] ?? "", m[2] ?? ""],
  );
  out.push(`def L.${name}(${params.map(([p]) => p).join(", ")}):`, ...caseTree(params, 1), "");
}
await Bun.write(join(lawsDir, "PROOF.bend"), out.join("\n"));
console.log("wrote packages/laws/PROOF.bend");
