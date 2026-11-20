// The requirement coverage check (Decision 12 of add-phase-1-core). Every scenario in openspec/specs
// needs a test that carries its name or an entry in tests/verified-elsewhere.yaml, no two scenarios
// may share a name, and every entry has to name a scenario that exists. Takes the repository's root
// as an argument, which the tests point at fixtures.
import { resolve } from "node:path";
import {
  coverage,
  formatReport,
  listTests,
  readEntries,
  readScenarios,
} from "./lib/requirement-coverage";

const root = resolve(process.argv[2] ?? resolve(import.meta.dir, ".."));
try {
  // The list and the specs come first, so a malformed list fails before the slower listing.
  const entries = readEntries(root);
  const scenarios = readScenarios(root);
  const report = coverage(scenarios, listTests(root), entries);
  console.log(formatReport(report));
  process.exitCode = report.failures.length > 0 ? 1 : 0;
} catch (error) {
  console.error(
    `Requirement coverage could not run: ${error instanceof Error ? error.message : String(error)}`,
  );
  process.exitCode = 1;
}
