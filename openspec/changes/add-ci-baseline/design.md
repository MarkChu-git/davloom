# Design

## Context

动机见 proposal.md，行为要求见 specs。

Phase 0 留下两条入口：`bun run check` 运行 lint、格式、精确版本、生成主题、类型、单元测试和构建；`bun run test:compat` 运行 Workers、Bun 和 Playwright 兼容性测试，没有 Cloudflare 凭据时以状态 0 退出。仓库还没有 `.github/`，也没有远程仓库。

和 CI 有关的现状（2026-11-06 查看）：

- HTTP 测试在 Node 上启动真实的 Bun 和 `wrangler dev` 进程，Bun SQLite 的测试用 `bun --bun vitest` 跑在 Bun 上，所以 CI 要同时装 Bun 和 Node。
- Bun 的版本写在根 `package.json` 的 `packageManager`（`bun@1.4.4`），`oven-sh/setup-bun` 默认读取这个字段。Node 的版本没有写在任何地方。
- `apps/api` 和 `tests/integration/compat` 各有两份 tsconfig：`tsconfig.json` 给 Bun，`tsconfig.workers.json` 给 Workers，两份互相排除对方的入口文件。
- `scripts/lib/pinned-deps.ts` 只检查 Astryx 和 StyleX 是否声明为精确版本，不比较 StyleX 和 Astryx 的 peer 依赖。Astryx 0.7.8 要求 `@stylexjs/stylex` 为 `^0.19.0`，现在装的是 0.19.1。
- 测试固定值 `compatibility-test-secret-not-used-anywhere-else` 出现在 4 个文件里。
- `bun outdated --filter '*'` 没有列出落后的依赖。

## Goals / Non-Goals

**Goals:**

- CI 只调用本地也能运行的命令，不在 workflow 里重写测试逻辑。
- 之后每个 Phase 新增测试时，只需要把它接入已有命令或加一个 job。

**Non-Goals:**

- 不实现部署和发布。Wrangler、Buildx、Changesets 和 Trivy 留到 Phase 6。
- 不在 Pull Request 上跑 Cloud Free 实测。它需要账号，也消耗当天配额，升级依赖后人工重跑。
- 不把覆盖率变成门槛。先看趋势，等 Phase 2 之后再决定。

## Decisions

### 1. 一个主 workflow，按运行时间分 job

| Job | 内容 | 必过 |
| --- | --- | --- |
| `check` | `bun install --frozen-lockfile`，`bun run check` | 是 |
| `compat` | 安装 Chromium，`bun run test:compat` | 是 |
| `workflows` | actionlint、zizmor | 是 |
| `secrets` | Gitleaks | 是 |
| `dependencies` | OSV-Scanner 扫 `bun.lock` | 是 |
| `coverage` | Vitest V8 Coverage，结果写入 job summary | 否 |

CodeQL 用单独的 workflow，因为它需要 `security-events: write`，和其他只读的 job 分开。依赖漏洞的定时扫描复用 `dependencies` 的步骤，每周运行一次。

`check` 和 `compat` 分开，是因为 `compat` 要装浏览器并上传 1 GiB，时间长得多，而大多数失败在 `check` 就能发现。把所有检查放进一个 job 也可以，但一项失败时要翻完整日志，Rulesets 也只能要求一个状态。

### 2. 类型感知规则并入 `bun run lint`

类型感知规则由 `oxlint-tsgolint` 提供。2026-11-06 用 `oxlint-tsgolint` 7.0.2006 在仓库上试跑，包装在临时目录里，没有写入仓库：

- 全仓库用时约 1.7 秒，所以不需要单独的 job，直接在 `oxlint.json` 打开 `options.typeAware`，由 `bun run lint` 运行。
- tsgolint 为每个文件找最近的 `tsconfig.json`。只被 Workers 配置包含的 9 个文件找不到配置，被当成没有类型信息的文件检查，报出 5 条 `error typed` 误报。
- 在副本里把这两个目录的 `tsconfig.json` 改成只有 `files: []` 和指向 `tsconfig.bun.json`、`tsconfig.workers.json` 的 `references`，tsgolint 建立 11 个 program，没有未匹配的文件，误报消失。在 `apps/api` 上，`tsc -p` 对这三份配置都以状态 0 退出。
- 剩下 43 条是真实问题：30 条 `no-unsafe-type-assertion`、7 条 `unbound-method`、3 条 `no-misused-spread`、2 条 `no-unnecessary-type-assertion`、1 条 `no-unnecessary-type-arguments`。其中 41 条在 `tests/integration/compat`。
- 在 Bun 文件和 `*.workers.ts` 里各放一个未处理的 Promise，`no-floating-promises` 都能报出。

实施时先修完这 43 条再打开规则，不关闭规则。确实要关闭的，在这里记录原因。`tsc` 继续作为类型检查的依据。

### 3. 用 Renovate，不用 Dependabot

GitHub 依赖图的[支持列表](https://docs.github.com/en/code-security/reference/supply-chain-security/dependency-graph-supported-package-ecosystems)里没有 Bun，依赖图读不到 `bun.lock`，基于它的 Dependabot 告警和 Dependency Review 都看不到锁文件里的间接依赖。Renovate 读取 GitHub 漏洞告警的 `vulnerabilityAlerts` 同样要求打开依赖图，所以改用 `osvVulnerabilityAlerts`。它用 OSV 的数据，只覆盖直接依赖。

配置要点，依据 Renovate 的[配置项文档](https://docs.renovatebot.com/configuration-options/)和 [Minimum Release Age 说明](https://docs.renovatebot.com/key-concepts/minimum-release-age/)：

- 不设等待期，也不设 `schedule`：新版本发布后，Renovate 下一次运行就开 PR（用户 2026-11-06 决定）。不设 `minimumReleaseAge`，例行时间表也会变相推迟更新，所以两者都不用。PR 数量靠分组和 `prConcurrentLimit` 控制，不开 automerge。
- 打开 Dependency Dashboard，在一个 issue 里列出所有待处理的更新。
- 版本保持精确，和 `bunfig.toml` 的 `exact = true` 一致。
- 直接依赖的安全修复由 `osvVulnerabilityAlerts` 单独开 PR。
- Lock File Maintenance 每周刷新 `bun.lock`，让间接依赖拿到修复。
- Astryx 的包分成一组。`@stylexjs/*` 用 `allowedVersions` 限制在 Astryx 的 peer 依赖范围内。Astryx 升级改了这个范围时，在同一个 PR 里升级 StyleX 并更新 `allowedVersions`。统一检查新增一项：已安装的 StyleX 必须满足 Astryx 的 peer 范围，否则失败。
- github-actions manager 同时更新 Action 的 SHA 和后面的版本注释，固定的版本不会慢慢过期。

### 4. 依赖漏洞用 OSV-Scanner，不用 Dependency Review

Dependency Review 依赖依赖图，同样看不到 `bun.lock`。[OSV-Scanner](https://google.github.io/osv-scanner/supported-languages-and-lockfiles/) 能直接读 `bun.lock`，包括间接依赖。

每个 PR 都扫描整个锁文件，所以一个新公开的漏洞会让所有 PR 失败。处理方式是修复，或者在 `osv-scanner.toml` 的 `IgnoredVulns` 里登记例外，写明 `reason` 和 `ignoreUntil` 到期日。到期后扫描重新失败。

### 5. 第三方工具用固定版本的 CLI

Gitleaks、OSV-Scanner、actionlint 和 zizmor 都用固定版本的 CLI，下载后校验 checksum，不走第三方 Action。这样 workflow 里的第三方代码最少，也容易在本地复现。版本在实施时查，遵守项目的依赖规则。

2026 年 3 月 [`trivy-action` 有 76 个 tag 被强推成窃取凭据的代码](https://github.com/aquasecurity/trivy/security/advisories/GHSA-69fq-xp46-6x23)，这是这条决定和 Action 固定到 SHA 的原因。

zizmor 1.32.0 的默认规则已经覆盖 `workflow-security` 的要求，不需要自定义配置。在 4 个示例 workflow 上试跑的结果：

| 示例 | 结果 |
| --- | --- |
| SHA 固定，声明 `permissions`，`actions/checkout` 不保留凭据 | 没有问题 |
| 用 tag 引用 Action | `unpinned-uses`，high |
| 不声明 `permissions` | `excessive-permissions`，medium |
| 由 `pull_request_target` 触发 | `dangerous-triggers`，high |

Gitleaks 的作者[已声明只修安全问题](https://github.com/gitleaks/gitleaks)，所以同时打开 GitHub 原生密钥扫描。测试固定值 `compatibility-test-secret-not-used-anywhere-else` 放进 Gitleaks 的允许清单。

### 6. 单人维护时不强制审批

GitHub 不允许作者批准自己的 PR，所以必需审批数设为 0，CODEOWNERS 只标明责任人。有第二个维护者时再打开。

仓库在接入基线 CI 时公开（用户 2026-11-06 决定），所以免费账号下 Rulesets、CodeQL 和原生密钥扫描都能用。

Ruleset 要求 `check`、`compat`、`workflows`、`secrets` 和 `dependencies` 通过，`coverage` 不在其中。CodeQL 用 Ruleset 的 Require code scanning results 规则，Security alerts 设为 High or higher，Alerts 设为 Errors。

### 7. 运行时版本

Bun 由 `oven-sh/setup-bun` 读取 `packageManager`。Node 新增 `.node-version`，`actions/setup-node` 用 `node-version-file` 读取，Renovate 也会更新它。

### 8. 每个 Phase 自带 CI 任务

之后每个 change 的 `tasks.md` 都带上把新测试接入 CI 的任务。这条写进 `AGENTS.md`、`CLAUDE.md` 和 `openspec/config.yaml` 的 tasks 规则，让 `/opsx:propose` 生成任务时能看到。

## Cloudflare Workers 和 Bun 的差异

CI 跑在 Linux 上，两种运行环境都在本地启动，不需要账号。

| 方面 | Workers | Bun |
| --- | --- | --- |
| 运行方式 | Node 上的 Vitest 启动 `wrangler dev`（workerd），D1 用 `@cloudflare/vitest-plugin` | Node 上的 Vitest 启动 Bun 进程，Bun SQLite 用 `bun --bun vitest` |
| 类型环境 | `tsconfig.workers.json` | `tsconfig.bun.json` |
| 浏览器测试 | 由 `wrangler dev` 提供静态资源 | 由 Bun 进程提供 |
| 只能在真实部署上验证的 | CPU 和请求体上限，在 CI 里显示为跳过 | 没有 |

## Risks / Trade-offs

- [`compat` 在 GitHub 托管的 runner 上变慢或不稳定，尤其是 1 GiB 上传和 `wrangler dev`] → 第一次接入时记录耗时。连续失败时先查根因，不靠重试掩盖；确实只和 runner 有关时再调整超时。
- [新公开的漏洞让所有 PR 失败] → 修复，或登记带到期日的例外，见决定 4。
- [固定到 SHA 后版本过期] → Renovate 更新 SHA，和依赖更新走同一流程。
- [刚发布就被撤回或被投毒的版本会马上进 PR] → 用户选择不设等待期，接受这个风险。缓解办法：不开 automerge，合并前要通过全部检查；OSV 收录了恶意包记录（`MAL-` 编号），OSV-Scanner 会拦下其中已登记的包。
- [Renovate 的 PR 太多] → 同类依赖分组，用 `prConcurrentLimit` 限制同时打开的数量。
- [公开仓库后 PR 来自不可信的 fork] → 这正是不用 `pull_request_target`、检查不读取 secrets 的原因。

## Migration Plan

没有存量 CI。按这个顺序接入：先让 workflow 跑通但不设为必过，修完现有问题后再打开 Rulesets。回滚只需关闭 Ruleset 或删除 workflow 文件。

## Open Questions

无。仓库公开时间和是否设更新等待期，用户已在 2026-11-06 决定，见决定 6 和决定 3。
