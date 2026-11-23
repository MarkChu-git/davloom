# Davloom

## Commands

Run everything on Bun: no script, test, tool or CI job installs, pins or calls Node. Start commands from the repository root, where `bunfig.toml` makes `bun run` start tools whose launchers name Node on Bun. That setting does not reach `bunx` or `bun run` inside a package directory, so give those `--bun`: wherever this file or a skill gives `bunx <tool>`, run `bunx --bun <tool>`.

`docs/ci.md` lists the CI jobs with the local command for each, the required checks, and what to do when a scan finds something.

- `bun install --frozen-lockfile`: install exactly what `bun.lock` records. It runs one dependency script, the `workerd` postinstall `node install.js`, on the first `node` on `PATH`, and on Bun when there is none.
- `bun run check`: run lint, format check, pinned dependency check, typecheck, unit tests and production builds, then name any step that failed.
- `bun run format`: rewrite files with Oxfmt.
- `bun run test:compat`: run the compatibility tests on local Bun and workerd, including Playwright against the production build. It needs no Cloudflare account, and reports what only a real deployment can test as skipped. Run `bun run --filter @davloom/compat-tests playwright:install` once first, or set `DAVLOOM_CHROMIUM_PATH` to a Chromium you already have.
- `bun run test:coverage`: run the unit tests with Istanbul coverage, print each package's coverage, and fail when a package falls below its thresholds in `vitest.config.ts`.
- `bun run scan:deps`: scan every package in `bun.lock` for published vulnerabilities with the pinned OSV-Scanner. Exceptions go in `osv-scanner.toml`, and `docs/ci.md` says when one is allowed.
- `bun run scan:secrets --log-opts=origin/main..HEAD`: scan the commits not yet on `main` for secrets with the pinned Gitleaks, which covers what CI scans for a pull request.
- `bun run scan:actionlint` and `bun run scan:zizmor`: check the workflows, and with zizmor the local actions, with the pinned actionlint and zizmor, as the `workflows` job does.
- `bun run laws:setup`: install the Bend and Lean releases that `packages/laws/toolchain.json` pins into the tool cache that `docs/ci.md` describes, and build Bend's `--verdict` kernel there with that Lean. An archive whose SHA-256 differs from its pin stops the run before anything is installed. The first run downloads about 600 MB; a second run downloads nothing.
- `bun run --filter @davloom/compat-tests cloud:free all`: deploy the probe to the Cloudflare account Wrangler is logged in to, measure the Free plan's limits, and delete everything. It writes about 31,000 Durable Object rows, about a third of the daily quota, so run it only when a measurement needs it.
- `bun outdated --filter '*'`: list dependencies behind the npm `latest` tag.

## Dependencies

Use the npm `latest` tag for every dependency, declared with an exact version (`bunfig.toml` sets this). Look the version up when adding a package instead of copying one from a doc. A pre-release version counts when the `latest` tag points to it. Pre-release tags such as `rc`, `beta` and `canary` do not count: take a version that only they point to only when nothing else works, and say why in the pull request. When a peer range blocks the newest version, use the newest one allowed and say why in the pull request.

The owner approved one standing exception on 2026-11-16: a direct `miniflare` dependency takes the exact version that the `latest` Wrangler pins, because Miniflare's own `latest` tag (4.20260730.0 that day) lags months behind the Miniflare that Wrangler uses.

## How work proceeds

The goal is a working product, shipped fast. On 2026-11-24 the owner said Davloom should go live within days, not weeks, and that effort spent on process and tooling polish was wasted. `prd.md` holds the requirements, and its §13 milestones set the order of work. `packages/laws/LAWS.bend` states what the decision logic guarantees, and tests pin down everything else.

New work does not go through OpenSpec. Take the next slice of the current milestone, build it with its tests, merge it, deploy it and check it with real clients. `openspec/specs/` and the changes under `openspec/changes/` stay as reference and get no additions. Before adding process, tooling, a gate or a document, check that it gets the product live sooner or keeps the code robust; skip it otherwise. Tests are the exception to keeping things small: write many, generated from tables and models (PRD §11). New tests run in CI from the pull request that adds them.

Raise any conflict between the code and the PRD with the owner instead of choosing one silently. Write every formal document in English: the PRD, `docs/`, pull request descriptions and Linear issues.

## Pull requests

Agents merge the pull requests they open from the owner's account without the owner's review. This replaces any rule that asks the owner before every merge. Agents never merge a pull request from anyone else, Renovate included: it needs two approvals or the owner's own merge.

Merge a pull request once every check on it passes and, when it changes product code in `apps/` or `packages/`, a subagent that did not write the change has reviewed the diff and found no blocking defect. Give the reviewer the diff, not your own conclusions, and ask only for defects that break behavior, security or data: wrong results, crashes, races, data loss, holes in authentication, authorization or path handling, and wrong protocol answers. Fix those, have the fix reviewed the same way, and merge. Style and wording never block. Changes to documentation, configuration or tests alone need only the checks.

Merge every pull request with GitHub's asynchronous merge API, because `gh pr merge` refuses a stacked pull request and `gh stack merge` cannot bypass the two approvals. Merge a stack from the bottom up, one pull request at a time:

1. Check that `gh pr view <n> --json baseRefName` shows `main`. If its base is a branch that has not merged yet, merge the pull request below it first. Otherwise the API would also merge every open pull request below `<n>`, or, for a pull request outside GitHub's stack, merge `<n>` into that branch instead of `main`. When the pull request below merges, GitHub retargets one still in its stack to `main` and then pushes a rebased head, so wait for both. A pull request that has left GitHub's stack (`gh api repos/MarkChu-git/davloom/pulls/<n> --jq .stack` prints `null`) is neither rebased nor retargeted, so it keeps a base that has already merged: rebase it with `but pull`, push it and run `gh pr edit <n> --base main` first.
2. Read `<head>` with `gh pr view <n> --json headRefOid`. If it is not the commit whose checks passed, because step 1 pushed it or GitHub rebased it, wait until every check on it passes, and stop if one fails.
3. Run `gh api -X PUT repos/MarkChu-git/davloom/pulls/<n>/merge-async -f sha=<head> -f merge_method=merge -f merge_action=direct_merge -F bypass_rules=true`. It returns a UUID before the merge runs.
4. Poll `gh api repos/MarkChu-git/davloom/pulls/<n>/merge-async/<uuid>` until its status is `merged`. Stop if it is `failed`; the response says why.
5. GitHub then rebases the pull requests still in its stack, so run `but pull` before changing them.

Bring the owner only major architecture decisions, before you build on them: changing the architecture or UI rules in this file; changing this section or any approval it names; adding, replacing or removing a runtime, framework, database, storage backend or cloud service; changing a public API or protocol contract; or changing the scope or milestones in `prd.md`. A pull request that carries one waits until the owner approves it in chat, and then an agent merges it. A pull request comment does not count, because agents also comment from the owner's account.

Everything else is the agent's call, the laws in `LAWS.bend` included: decide, build, merge and deploy without asking.

## Deployment

Agents deploy Davloom to the owner's Cloudflare Workers Free account without asking, using only free services. Enabling a paid service such as R2, or adding a payment method, is the owner's decision. The account also holds other projects, so never change or delete anything Davloom did not create.

## Architecture rules

Davloom follows Hexagonal architecture with Effect Layers.

- Domain code never imports a cloud vendor SDK. Cloudflare-only features appear only in the infrastructure layer.
- Elysia routes never touch storage backends or D1 directly, and TanStack Start never reads the database. Effect Services reach infrastructure through Ports, and every Adapter must pass the shared contract tests.
- The WebDAV entry point takes a Web standard `Request` and returns a `Response`, so the protocol engine can be tested without an HTTP framework.
- Production entries never import from `tests/integration/compat/probe`.
- Never advertise a protocol capability that is not implemented correctly.
- Write logic that decides an outcome without IO in Bend 2 from the start, with its laws in `LAWS.bend` and their proofs in `PROOF.bend` (PRD §4, Proven Domain Logic). Test each compiled module with table-driven and property cases as soon as it exists. A feature may run on the owner's account for trials before its proofs land, but no release ships an unproven law. Agents write and change the laws themselves; a law is never weakened or deleted to make a proof pass, and the review of a pull request that changes `LAWS.bend` checks that no law got weaker.

## UI rules

- Use an existing Astryx component or design token before writing your own. Never patch or copy dependency source; `packages/ui` holds only Davloom business components, themes and tokens.
- Astryx ships as its official precompiled CSS, and Davloom's own styles use StyleX. Do not add a second CSS-in-JS library, Tailwind, shadcn/ui or Radix.
- Astryx and StyleX stay on exact versions, and StyleX follows the Astryx peer dependency. `bun run check` enforces this.
- Search before writing UI: `bunx astryx search "<query>"` finds components, hooks, docs and templates, and `bunx astryx component <Name>` prints a component's API.
- The generated Astryx block below says there is no StyleX compiler. Davloom has one (`@stylexjs/unplugin`), so Davloom's own components use `stylex.create()` and `stylex.props()` with Astryx tokens. Astryx components themselves stay on props and tokens, and never depend on Astryx's generated class names.
- The generated Astryx block below prefers the experimental theme editor for making or changing a theme. Davloom's theme stays hand-written: `packages/ui/src/themes/davloom-source.ts` extends the neutral theme in code and maps the values in `packages/ui/src/tokens/` onto Astryx tokens. Change values in those token files and the mapping in the source, rebuild `davloom.css` with `bun run --filter @davloom/ui build:theme`, and look at the result in light and dark mode on the Dashboard (`bun run --filter @davloom/web dev`) instead of the editor's PNGs. Do not move the theme to the editor.

## Issue tracker

Issues live in Linear team Mark's Workplace, project davloom (P-MAR-3), with a milestone for each PRD phase. Update a milestone when its work starts and when it ships; single tasks are not tracked there.

## Code intelligence

Use GitNexus (section below), not graphify. Run its CLI on Bun as `bunx --bun gitnexus <command>` wherever the generated section or a GitNexus skill gives `node .gitnexus/run.cjs`, `npx` or a `bunx` without `--bun`. `bun .gitnexus/run.cjs` is not enough, because it starts the global `gitnexus` launcher, whose shebang names Node.

## Judging many files

Use the Jev MCP (`jev_ask`) often. Reach for it first when a question is a judgment across files or records: classifying, triaging, ranking, filtering, deciding which files belong to a feature, or checking content against a rule in this file or a spec. Above roughly 50 files or records, ask Jev before reading or grepping them yourself. One call answers all of them and keeps their text out of the conversation.

- Pass globs in `files`, the rule to apply in `context`, and use `where`, `top` or `counts` to get back only what you need. One call takes at most 100 files or 500 records.
- Trust `act` answers. Settle `review` and `abstain` answers yourself, starting from the text in `unsure`.
- Keep exact lookups such as IDs, symbols and sums in grep or code. Callers, imports and blast radius stay with GitNexus.

<!-- gitnexus:start -->
# GitNexus — Code Intelligence

This project is indexed by GitNexus as **davloom** (170 symbols, 168 relationships, 0 execution flows).

> Index stale? Run `node .gitnexus/run.cjs analyze --index-only` from the project root — it auto-selects an available runner. No `.gitnexus/run.cjs` yet? Bootstrap with `npx`, `bunx`, or `pnpm dlx` — e.g. `bunx gitnexus@latest analyze` (npm 11 npx crash; #1939).

## Always Do

- **MUST run impact before editing.** Use `impact({target: "symbolName", direction: "upstream"})` or `node .gitnexus/run.cjs impact "symbolName" --direction upstream --repo .`; report callers, processes, and risk. Never substitute grep for graph analysis.
- **MUST analyze graph changes before committing.** Use `detect_changes({scope: "all"})` (MCP) or `node .gitnexus/run.cjs detect-changes --scope all --repo .` (CLI fallback). `partial: true` or `truncated: true` is not a clean check — a zero means unseen, not unaffected; re-run it. For regression review: `detect_changes({scope: "compare", base_ref: "main"})` or `node .gitnexus/run.cjs detect-changes --scope compare --base-ref "main" --repo .`.
- MUST warn on HIGH/CRITICAL `risk` pre-edit; never use `riskSharedAxes` to waive a HIGH/CRITICAL `risk` warning. Compare File/symbol: MCP File omits axes; Graph-RAG expands File.
- **MUST treat `risk: UNKNOWN` as unresolved, not as low.** An empty caller set is not evidence the symbol is unused — it can also mean the callers are not resolvable by the index (plain-object property access, dynamic dispatch, cross-language calls). `impact` pairs `UNKNOWN` with a `riskNote` saying so. Confirm with a text search before treating the symbol as safe to change or delete; do not proceed on the strength of a zero.
- **MUST use `query({search_query: "concept"})` for concepts/flows, `context({name: "symbolName"})` for a named symbol, or `impact` for blast radius, on read-only callers, dependencies, imports, or execution flow.** Graph first; text search only for empty/`UNKNOWN`/literals.
- For security review, `explain({target: "fileOrSymbol"})` lists taint findings (source→sink flows; needs `analyze --pdg`).

## Never Do

- NEVER edit a function, class, or method before MCP/CLI impact analysis.
- NEVER ignore HIGH or CRITICAL risk warnings from impact analysis, and never read `UNKNOWN` as an all-clear — it means the walk could not answer, which is the one verdict that requires confirming by other means.
- NEVER rename symbols with find-and-replace — use `rename` which understands the call graph.
- NEVER commit before MCP/CLI graph change analysis.

## Resources

| Resource | Use for |
| --- | --- |
| `gitnexus://repo/davloom/context` | Codebase overview, check index freshness |
| `gitnexus://repo/davloom/clusters` | All functional areas |
| `gitnexus://repo/davloom/processes` | All execution flows |
| `gitnexus://repo/davloom/process/{name}` | Step-by-step execution trace |

## CLI

| Task | Read this skill file |
| --- | --- |
| Understand architecture / "How does X work?" | `.claude/skills/gitnexus-exploring/SKILL.md` |
| Blast radius / "What breaks if I change X?" | `.claude/skills/gitnexus-impact-analysis/SKILL.md` |
| Trace bugs / "Why is X failing?" | `.claude/skills/gitnexus-debugging/SKILL.md` |
| Rename / extract / split / refactor | `.claude/skills/gitnexus-refactoring/SKILL.md` |
| Tools, resources, schema reference | `.claude/skills/gitnexus-guide/SKILL.md` |
| Index, status, clean, wiki CLI commands | `.claude/skills/gitnexus-cli/SKILL.md` |

<!-- gitnexus:end -->

<!-- ASTRYX:START -->
Astryx v0.7.16 · 174 components
CLI: run every command as `bunx astryx <cmd>` (shown below as `astryx ...`).

SETUP (once, in app entry e.g. main.tsx) — without these, components render unstyled:
  import "@astryxdesign/core/reset.css";
  import "@astryxdesign/core/astryx.css";

WORKFLOW — start every page from a template, never from scratch:
1. `astryx build "<idea>"` — names the template to scaffold from and the parts it lacks.
2. `astryx template <name> <path>` — scaffold it; keep its frame, gap and padding; replace the content.
3. `astryx template <Block>` for parts it lacks; `astryx component <Name>` to read props before using one.
Changing an existing page? Keep it: skip step 2 and add blocks/components inside its sections.
Before you deliver a build, run `astryx doctor --built <dir>`; don't deliver it if it fails.

RULES:
- No <div> — components handle all layout and spacing.
- Read `astryx docs layout` before changing a template's frame.
- Dense data = rows (Table, List/Item), not Card-wrapped lists. Badge = counts only.
- Style with component props first, then tokens (var(--color-*|--spacing-*|--radius-*)). No raw hex/px. No StyleX/Tailwind compiler here — don't use xstyle/utility classes directly. Some templates use StyleX and need a compiler plugin; see `astryx docs styling-overview`.
- THEMES: palettes and custom colors go through the theme, never :root overrides. To make or change a theme (colors, fonts, corners, spacing, a look from a picture), prefer the experimental theme editor over hand-written theme files: `astryx experimental theme editor new <name> --like neutral`, then `editor set <name> <thing> <value>` or `editor how "<what you want>"`; wire it with `astryx theme add <name>`; after each change look at it with `astryx experimental theme editor show <name> --png` and open the PNGs it writes (changes nothing in the app); a theme change is not done until you have looked at the pictures. In code, extend an imported theme to customize it; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
