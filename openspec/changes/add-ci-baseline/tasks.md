# Tasks

## 1. 前置条件

- [ ] 1.1 确认 `add-phase-0-foundation` 已归档，验证 `openspec list` 不再列出它，`openspec/specs/` 下有它的 4 个 capability
- [ ] 1.2 在 GitHub 创建公开仓库，推送 `main` 前取得用户确认，验证 `git ls-remote origin main` 返回本地 `main` 的提交，仓库设置显示为 Public

## 2. 本地检查

- [ ] 2.1 添加 `.node-version`，写入实施时 Node 的最新正式版本，验证本地 `node --version` 与它一致，并且 `bun run test:compat` 以状态 0 退出
- [ ] 2.2 把 `apps/api` 和 `tests/integration/compat` 的 `tsconfig.json` 改成只引用 `tsconfig.bun.json` 和 `tsconfig.workers.json`，同步各自的 `typecheck` 脚本，验证 `bun run typecheck` 通过，类型感知 lint 的调试日志显示 `Unmatched files: 0`
- [ ] 2.3 以精确版本添加 `oxlint-tsgolint`，在 `oxlint.json` 打开 `options.typeAware` 并修完现有问题，验证 `bun run lint` 通过，并且在 Bun 文件和 `*.workers.ts` 里各放一个未处理的 Promise 时 lint 都失败并指出该行
- [ ] 2.4 在 `scripts/lib/pinned-deps.ts` 增加 StyleX 对 Astryx peer 依赖范围的检查并接入 `bun run check`，验证单元测试覆盖范围内和范围外两种情况，并让 `AGENTS.md`、`CLAUDE.md` 对这项检查的描述和实现一致
- [ ] 2.5 以精确版本添加 `@vitest/coverage-v8` 和 `bun run test:coverage`，验证命令生成覆盖率报告，覆盖率高低不影响退出状态

## 3. Pull Request 检查

- [ ] 3.1 新建 `.github/workflows/ci.yml` 的 `check` job：在 Pull Request 和推送到 `main` 时触发，workflow 级 `permissions: contents: read`，`actions/checkout` 不保留凭据，Action 固定到 SHA，Bun 读取 `packageManager`，Node 读取 `.node-version`，运行 `bun install --frozen-lockfile` 和 `bun run check`。验证测试分支上 job 通过，只改 `package.json` 不更新 `bun.lock` 时安装步骤失败
- [ ] 3.2 增加 `compat` job，缓存 Playwright 浏览器，运行 `playwright:install` 和 `bun run test:compat`，验证 job 通过，日志里需要真实部署的用例显示为跳过
- [ ] 3.3 增加 `coverage` job，把总覆盖率写入 job summary，验证 summary 显示覆盖率，并且这个 job 不在必过检查里
- [ ] 3.4 新建 `docs/ci.md`，写明每个 job 对应的本地命令和哪些检查必过，并记录 3.1 和 3.2 第一次运行的耗时，验证文中每条命令在本地的结果和 CI 一致

## 4. 安全扫描

- [ ] 4.1 增加 `dependencies` job：下载固定版本的 OSV-Scanner 并校验 checksum，扫描 `bun.lock`，例外登记在 `osv-scanner.toml`。验证当前锁文件扫描通过；含已公开漏洞版本的临时锁文件扫描失败并输出漏洞编号；登记未到期的例外后通过，到期后再次失败
- [ ] 4.2 增加 `secrets` job：下载固定版本的 Gitleaks 并校验 checksum，扫描 Pull Request 新增的提交，输出时隐去密钥，允许清单只放测试固定值。验证完整历史扫描通过；临时分支上提交伪造的云服务密钥后扫描失败，输出里没有完整密钥
- [ ] 4.3 新建 `.github/workflows/codeql.yml`，只给它的 job `security-events: write`，验证 `main` 上出现 CodeQL 分析结果，日志里没有 TypeScript 提取错误
- [ ] 4.4 给依赖扫描加每周定时和手动触发，验证手动触发一次成功
- [ ] 4.5 在 `docs/ci.md` 写明如何登记漏洞例外和处理密钥误报，验证按文中步骤能在本地复现 4.1 和 4.2 的结果

## 5. 工作流安全

- [ ] 5.1 增加 `workflows` job：下载固定版本的 actionlint 和 zizmor 并校验 checksum，检查 `.github/workflows/`。验证仓库里的 workflow 全部通过；用 tag 引用 Action、不声明 `permissions`、由 `pull_request_target` 触发、有语法错误的四个临时 workflow 都失败
- [ ] 5.2 确认 workflow 除 `GITHUB_TOKEN` 外不引用任何 secrets，由用户用另一个账号从 fork 发起测试 Pull Request，验证必过检查全部运行，结果和仓库内分支一致

## 6. 依赖更新

- [ ] 6.1 按 design.md 决定 3 新建 `renovate.json`，验证 `renovate-config-validator` 通过
- [ ] 6.2 由用户在 GitHub 上安装 Renovate App，验证 Dependency Dashboard 出现并列出 OSV 漏洞摘要，第一个更新 Pull Request 的版本声明仍是精确版本且检查通过
- [ ] 6.3 在 `docs/ci.md` 写明 Renovate 的规则和 StyleX 跟随 Astryx 升级的步骤，验证文中步骤和 `renovate.json` 一致

## 7. 仓库配置

- [ ] 7.1 新建 `.github/CODEOWNERS`，验证 Pull Request 页面显示各目录的责任人
- [ ] 7.2 第 3 到 6 组的检查都通过后，为 `main` 创建 Ruleset：禁止删除和强制推送，要求 Pull Request 和必过检查，CodeQL 用 Require code scanning results，审批数为 0，配置导出为 JSON 存进仓库。验证直接推送和强制推送被拒绝，检查失败的 Pull Request 不能合并，维护者在检查通过后不经审批就能合并自己的 Pull Request
- [ ] 7.3 打开 GitHub 原生密钥扫描和推送保护，验证设置页显示两项都已开启

## 8. 项目规则

- [ ] 8.1 在 `AGENTS.md`、`CLAUDE.md` 和 `openspec/config.yaml` 的 tasks 规则里加上“每个 change 的 tasks.md 都带上把新测试接入 CI 的任务”，并在 Commands 里指向 `docs/ci.md`，验证 `openspec instructions tasks` 的输出包含这条规则

## Workflow follow-up

- 开始实施前，经用户同意后在 Linear 项目 davloom 建立和上面任务同编号的子任务。
- 用户审阅后归档这个 change。
- 归档后确认 `openspec/specs/` 下生成了 4 个新 capability 的 spec。
