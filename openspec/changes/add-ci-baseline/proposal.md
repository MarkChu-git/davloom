# Proposal

## Why

现在所有检查都只在本机运行，`main` 上没有任何东西能挡住未通过检查的改动。Phase 1 之后存储和协议代码会快速增长，所以要在 Phase 0 归档后先接入一条基线 CI，之后每个 Phase 只往里加自己的测试。

## What Changes

- PR 必过的质量检查：按锁文件安装依赖、Oxlint（含类型感知规则）、Oxfmt、TypeScript、Vitest、Workers 和 Bun 兼容性测试、Playwright、生产构建。
- PR 必过的安全扫描：OSV-Scanner、Gitleaks、CodeQL。
- 工作流自身的安全：Action 固定到 commit SHA，最小 `permissions`，不用 `pull_request_target`，由 actionlint 和 zizmor 检查。
- 依赖更新：Renovate 持续提出更新，保持精确版本。
- 仓库配置：GitHub Rulesets 保护 `main`，CODEOWNERS 标明责任人但不强制审核。
- 覆盖率：Vitest V8 Coverage 只报告趋势，不阻塞合并。
- 本地配套改动三处：`apps/api` 和 `tests/integration/compat` 的 `tsconfig.json` 改为分别引用 Bun 和 Workers 的配置；统一检查新增 StyleX 对 Astryx peer 依赖的检查；Node 版本写进 `.node-version`。
- 项目规则：之后每个 Phase 的 `tasks.md` 都带上把新测试接入 CI 的任务。

不包含：Testcontainers + RustFS、StrykerJS（Phase 1），RFC 测试 + litmus（Phase 2），k6（Phase 5），发布流水线（Phase 6）。oasdiff、Lighthouse CI、CodSpeed、Cosign 暂不接入。这些的安排见 PRD 第 11 节。

## Capabilities

### New Capabilities

- `pull-request-checks`: Pull Request 合并前必须通过的质量检查和安全扫描。
- `workflow-security`: CI 工作流自身的权限、触发方式和第三方 Action 的约束。
- `dependency-updates`: 依赖如何持续更新，以及新版本和已知漏洞如何处理。
- `branch-protection`: `main` 分支接受哪些改动，以及单人维护时的审批规则。

### Modified Capabilities

无。`repository-checks` 来自尚未归档的 `add-phase-0-foundation`，归档前不能作为 Modified Capability。StyleX 的 peer 依赖检查写在 `dependency-updates` 里，`repository-checks` 已有的要求不变。

## Impact

- 代码：新增 `.github/workflows/`、`.github/CODEOWNERS`、`renovate.json`、`osv-scanner.toml`、Gitleaks 配置、`.node-version` 和 `docs/ci.md`；`oxlint.json` 打开类型感知规则；`apps/api` 和 `tests/integration/compat` 调整 tsconfig 结构；`scripts/lib/pinned-deps.ts` 增加 peer 依赖检查；新增开发依赖 `oxlint-tsgolint` 和 `@vitest/coverage-v8`。
- 外部系统：需要一个 GitHub 仓库和 Renovate GitHub App。GitHub 免费账号下，Rulesets 只支持公开仓库，CodeQL 和原生密钥扫描也只对公开仓库免费。
- 前置条件：`add-phase-0-foundation` 完成并归档，兼容性测试命令在没有云凭据时以状态 0 退出。
- 文档：`AGENTS.md`、`CLAUDE.md` 和 `openspec/config.yaml` 补充 CI 规则。`AGENTS.md` 和 `CLAUDE.md` 现在说 `bun run check` 会检查 StyleX 跟随 Astryx 的 peer 依赖，实际只检查精确版本，实施后两者一致。
