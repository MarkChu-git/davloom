# Davloom

## Commands

Run everything on Bun: no script, test, tool or CI job installs, pins or calls Node (task 2.1 of `add-ci-baseline` finishes the switch).

- `bun install --frozen-lockfile`: install exactly what `bun.lock` records.
- `bun run check`: run lint, format check, pinned dependency check, typecheck, unit tests and production builds, then name any step that failed.
- `bun run format`: rewrite files with Oxfmt.
- `bun run test:compat`: run the compatibility tests on local Bun and workerd, including Playwright against the production build. It needs no Cloudflare account, and reports what only a real deployment can test as skipped. Run `bun run --filter @davloom/compat-tests playwright:install` once first, or set `DAVLOOM_CHROMIUM_PATH` to a Chromium you already have.
- `bun run test:coverage`: run the unit tests with Istanbul coverage, print each package's coverage, and fail when a package falls below its thresholds in `vitest.config.ts`.
- `bun run --filter @davloom/compat-tests cloud:free all`: deploy the probe to the Cloudflare account Wrangler is logged in to, measure the Free plan's limits, and delete everything. It writes about 31,000 Durable Object rows, about a third of the daily quota. Ask the user before running it.
- `bun outdated --filter '*'`: list dependencies behind the npm `latest` tag.
- `openspec list`: show active changes.
- `openspec validate <change> --strict`: validate a change before and after editing it.

## Dependencies

Use the npm `latest` tag for every dependency, declared with an exact version (`bunfig.toml` sets this). Look the version up when adding a package instead of copying one from a doc. Pre-release tags such as `rc`, `beta` and `canary` do not count. When a peer range blocks the newest version, use the newest one allowed and record why in the change's `design.md`.

## Spec workflow

Davloom uses OpenSpec, and `prd.md` is the source of requirements. New behavior starts as a change under `openspec/changes/`: propose it with `/opsx:propose`, implement it with `/opsx:apply`, and archive it with `/opsx:archive` once the user has reviewed the result. Raise any conflict between a spec and the PRD with the user instead of choosing one silently. Write every formal document in English: the PRD, OpenSpec artifacts, `docs/`, pull request descriptions and Linear issues. Archived changes keep the language they were written in.

## Pull requests

Agents merge the pull requests they open from the owner's account without the owner's review. This replaces any rule that asks the owner before every merge. Agents never merge a pull request from anyone else, Renovate included: it needs two approvals or the owner's own merge.

Merge a pull request once all of these hold:

- Every check on it passes. Until CI runs the project checks, `bun run check` and `bun run test:compat` must also pass locally on code identical to its head.
- A subagent that did not write the change has reviewed it for correctness and against this file, `openspec/config.yaml`, `prd.md`, `.gitmessage` and the OpenSpec change it implements, and found nothing blocking. Give the reviewer the diff and the rules, not your own conclusions.
- Every blocking finding is fixed, and the fix has passed the same review.

Merge every pull request with GitHub's asynchronous merge API, because `gh pr merge` refuses a stacked pull request and `gh stack merge` cannot bypass the two approvals. Merge a stack from the bottom up, one pull request at a time:

1. Check that `gh pr view <n> --json baseRefName` shows `main`. If its base is a branch that has not merged yet, merge the pull request below it first. Otherwise the API would also merge every open pull request below `<n>`, or, for a pull request outside GitHub's stack, merge `<n>` into that branch instead of `main`. When the pull request below merges, GitHub retargets one still in its stack to `main` and then pushes a rebased head, so wait for both. A pull request that has left GitHub's stack (`gh api repos/MarkChu-git/davloom/pulls/<n> --jq .stack` prints `null`) is neither rebased nor retargeted, so it keeps a base that has already merged: rebase it with `but pull`, push it and run `gh pr edit <n> --base main` first.
2. Read `<head>` with `gh pr view <n> --json headRefOid`. If it is not the commit whose checks passed, because step 1 pushed it or GitHub rebased it, wait until every check on it passes, and stop if one fails.
3. While CI does not run the project checks, run `bun install --frozen-lockfile`, `bun run check` and `bun run test:compat` in a clean export of `<head>` (`git archive <head> | tar -x -C <empty directory>`), not in the GitButler workspace, which can hold other branches. A run that passed on the same tree (`git rev-parse <head>^{tree}`) counts.
4. Run `gh api -X PUT repos/MarkChu-git/davloom/pulls/<n>/merge-async -f sha=<head> -f merge_method=merge -f merge_action=direct_merge -F bypass_rules=true`. It returns a UUID before the merge runs.
5. Poll `gh api repos/MarkChu-git/davloom/pulls/<n>/merge-async/<uuid>` until its status is `merged`. Stop if it is `failed`; the response says why.
6. GitHub then rebases the pull requests still in its stack, so run `but pull` before changing them.

Bring the owner only major architecture decisions, before you build on them: changing the architecture or UI rules in this file; changing this section or any approval this file names; adding, replacing or removing a runtime, framework, database, storage backend or cloud service; changing a public API or protocol contract; or changing the scope or phases in `prd.md`. A pull request that carries one waits until the owner approves it in chat, and then an agent merges it. A pull request comment does not count, because agents also comment from the owner's account. For the same reason, never add the `laws-approved` label yourself: only the owner adds it (PRD §4). The other approvals this file names still apply: changes to `LAWS.bend`, conflicts between a spec and the PRD, runs of `cloud:free`, and the owner's review before `/opsx:archive`.

## Architecture rules

Davloom follows Hexagonal architecture with Effect Layers.

- Domain code never imports a cloud vendor SDK. Cloudflare-only features appear only in the infrastructure layer.
- Elysia routes never touch storage backends or D1 directly, and TanStack Start never reads the database. Effect Services reach infrastructure through Ports, and every Adapter must pass the shared contract tests.
- The WebDAV entry point takes a Web standard `Request` and returns a `Response`, so the protocol engine can be tested without an HTTP framework.
- Production entries never import from `tests/integration/compat/probe`.
- Never advertise a protocol capability that is not implemented correctly.
- Write logic that decides an outcome without IO in Bend 2, with its laws in `LAWS.bend` and their proofs in `PROOF.bend` (PRD §4, Proven Domain Logic). Every change to `LAWS.bend` needs the owner's approval, and a law is never weakened or deleted to make a proof pass.

## UI rules

- Use an existing Astryx component or design token before writing your own. Never patch or copy dependency source; `packages/ui` holds only Davloom business components, themes and tokens.
- Astryx ships as its official precompiled CSS, and Davloom's own styles use StyleX. Do not add a second CSS-in-JS library, Tailwind, shadcn/ui or Radix.
- Astryx and StyleX stay on exact versions, and StyleX follows the Astryx peer dependency. `bun run check` enforces this.
- Search before writing UI: `bunx astryx search "<query>"` finds components, hooks, docs and templates, and `bunx astryx component <Name>` prints a component's API.
- The generated Astryx block below says there is no StyleX compiler. Davloom has one (`@stylexjs/unplugin`), so Davloom's own components use `stylex.create()` and `stylex.props()` with Astryx tokens. Astryx components themselves stay on props and tokens, and never depend on Astryx's generated class names.

## Issue tracker

Issues live in Linear team Mark's Workplace, project davloom (P-MAR-3). Each PRD phase has a milestone, and Phase 0 sub-issues carry the `tasks.md` number in their title. `tasks.md` is the source of truth for progress, so update the matching Linear issue when a task starts or finishes.

## Code intelligence

Use GitNexus (section below), not graphify.

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
Astryx v0.7.8 · 90+ components
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
- Palettes and custom colors go through the theme, never :root overrides. Run `astryx theme add <slug>` to import; `theme eject <slug>` only forks source. See `astryx docs theme`.
- SELF-CHECK: re-read the file; replace any raw <div>/<span>, imported .css/@apply, or hardcoded #hex/px with the component or a token.

`astryx help` lists every command. Key ones beyond the workflow:
  search "<query>"   find any component / hook / doc / template
  discover <words>   integrations you could add
  docs <topic>       getting-started, principles, tokens, theme … (`astryx docs` lists all)
  docs cli           commands and API reference
  docs authoring     build an integration package, and every field it holds
  upgrade --from <old version> --apply   run after a dependency bump
<!-- ASTRYX:END -->
