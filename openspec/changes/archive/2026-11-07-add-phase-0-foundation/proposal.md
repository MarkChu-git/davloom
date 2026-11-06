# Proposal

## Why

PRD 的选型里有几项还没有人验证过能否组合运行：Elysia 的 Workers 适配器在官方文档中仍标为 experimental，Astryx 还是 0.x 版本，Cloud Free 每个 HTTP 请求只有 10 ms CPU。后续的存储、协议和 Dashboard 都建立在这些假设上，所以要先用可重复的测试得到结论，再写它们的 spec。

## What Changes

- 建立 Bun Workspaces 单仓骨架，提供统一的检查命令，并在项目 `AGENTS.md` 中补充开发规则。
- 建立 API 骨架：在 Workers 和 Bun 上接收全部 WebDAV 方法，并流式传输请求体和响应体。协议行为实现之前一律返回 501，不声明任何 DAV 能力。
- 建立 Dashboard 骨架：以 SPA 模式运行，集成 Astryx 和 StyleX，支持 Light / Dark / System。
- 建立可重复运行的兼容性测试，覆盖业务编排、身份组件在 D1 和 SQLite 上的行为，以及 Cloud Free 的 CPU、请求体和每日配额限制。
- 产出 Phase 0 结论文档，逐项记录 PRD 验证清单的结果，并确定 Elysia 起步版本和目录 COPY/MOVE 的同步处理上限。

不包含：真实的 WebDAV 协议行为（Phase 2）、存储 Adapter（Phase 1）、正式的认证和权限流程（Phase 3）、Dashboard 业务页面（Phase 4）、Docker 部署（Phase 6）和 CI 工作流。

## Capabilities

### New Capabilities

- `repository-checks`: 贡献者用统一命令运行代码质量检查和生产构建。
- `webdav-transport`: WebDAV 请求在 Workers 和 Bun 上的方法分发、请求信息保留和流式传输。
- `runtime-compatibility-checks`: 选型组合的可重复验证，以及 Cloud Free 限制的实测记录。
- `dashboard-appearance`: Dashboard 的主题机制和 Light / Dark / System 外观模式。

### Modified Capabilities

无。

## Impact

- 代码：新增 `apps/api`、`apps/web`、`packages/core`、`packages/auth`、`packages/database`、`packages/webdav`、`packages/ui` 和 `tests/integration/compat`。
- 依赖：首次引入 PRD 第 2 节的前端、后端、身份、数据和工程工具依赖，其中 Astryx 和 StyleX 固定精确版本。存储 SDK 留到 Phase 1。
- 外部系统：实测部分需要一个 Cloudflare 账号，使用 Workers、D1 和 Durable Objects，不需要绑定支付方式。探测 Worker 和测试数据在实测结束后删除。
- 文档：扩充 `AGENTS.md`，新增 `docs/architecture/phase-0-findings.md`。实测结果写回 `prd.md`；如果结果要求改变选型或安全参数，先由用户决定。
