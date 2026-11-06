# Tasks

## 1. 单仓骨架和统一检查

- [x] 1.1 创建 Bun Workspaces 根配置，以及 proposal 列出的 `apps/*`、`packages/*` 和 `tests/integration/compat`，验证 `bun install` 后再运行 `bun install --frozen-lockfile` 成功且 `bun.lock` 没有变化
- [x] 1.2 以精确版本添加 Astryx 和 StyleX 依赖，添加依赖声明检查脚本，验证脚本在出现 `^` 时失败、恢复后通过
- [x] 1.3 配置 Oxlint、Oxfmt、TypeScript 7 的原生 `tsc` 和 Vitest，添加根目录 `bun run check`，用一个临时类型错误验证命令以非零状态退出，恢复后以状态 0 退出
- [x] 1.4 在项目 `AGENTS.md` 中补充 OpenSpec 流程、架构依赖规则和 Astryx 组件优先规则，保留 GitNexus 生成的段落，验证文中列出的命令都能运行

## 2. API 骨架和 WebDAV 传输层

- [x] 2.1 在 `apps/api` 建立应用工厂以及 Workers 和 Bun 两个启动入口，提供 `GET /api/health`，验证 Vitest 在 workerd 和 Bun 上都得到 200
- [x] 2.2 在 `packages/core` 实现 Effect 结果到 HTTP 响应的统一映射，验证两种运行时上成功、已声明错误和未预期缺陷三个用例通过
- [x] 2.3 在生产入口注册 `/dav/*` 全部方法并关闭 body 解析，验证两种运行时都返回 501 且不含 `DAV` 响应头，`/api/health` 不受影响
- [x] 2.4 在 `tests/integration/compat/probe` 建立探测入口和回显处理器，验证全部方法、百分号编码路径和 WebDAV 请求头在两种运行时上原样到达，生产入口请求探测路由返回 404
- [x] 2.5 添加分段上传和分段下载测试，验证两种运行时上接收方都在对方发送下一段之前收到第一段
- [x] 2.6 添加 Bun 上 1 GiB 上传测试并调高请求体上限，验证上传成功且常驻内存峰值增量低于 128 MiB
- [x] 2.7 用 Elysia `2.0.0-rc.3` 重跑 2.3 到 2.6 的测试，把两个版本的结果写入 `docs/architecture/phase-0-findings.md`，验证文档中有两个版本的通过情况

## 3. 身份组件兼容性

- [x] 3.1 在 `packages/database` 和 `packages/auth` 建立 Drizzle schema、迁移和 Better Auth 配置，验证同一份迁移在 D1（workerd）和 Bun SQLite 上都能执行
- [x] 3.2 添加管理员登录测试，验证两种数据库上正确密码建立 Session，错误密码被拒绝
- [x] 3.3 添加 API Key 生命周期测试，验证两种数据库上撤销前通过、撤销后失败，并查询数据库确认没有 Key 明文
- [x] 3.4 在探测入口支持用 Basic Auth 携带 API Key，验证有效 Key 通过，无效和已撤销的 Key 返回 401

## 4. Dashboard 骨架

- [x] 4.1 在 `apps/web` 建立 TanStack Start SPA，接入 React 19、Astryx 预编译 CSS 和 `@astryxdesign/theme-neutral`，验证 `bun run build` 成功
- [x] 4.2 接入 `@stylexjs/unplugin`，添加设计系统组件和自有组件并存的示例页，验证 Playwright 在生产构建上读到预期的计算样式
- [x] 4.3 在 `packages/ui` 定义 Davloom Theme 令牌，验证修改品牌色并重新构建后两类组件的品牌色都变化，且仓库中没有依赖补丁
- [x] 4.4 实现 Light / Dark / System 切换和持久化，验证 Playwright 覆盖切换、刷新后首次绘制和系统配色变化三个场景
- [x] 4.5 在示例页加入 Dialog 和 Menu，验证 Playwright 键盘操作正常、焦点回到触发元素、控制台没有错误
- [x] 4.6 提供 Workers 静态资源和 Bun 两种交付方式，验证 Playwright 在两种方式下直接打开深层路由都能渲染

## 5. Cloud Free 实测（需要 Cloudflare 账号，不需要绑卡）

- [x] 5.1 创建 D1 测试数据库，部署受一次性令牌保护、带 SQLite 后端 Durable Object 的探测 Worker，验证部署成功，并把压缩后体积和启动时间写入结论文档
- [x] 5.2 连续发送 100 次携带 API Key 的探测请求和 20 次管理员登录请求，验证结论文档记录了 CPU 时间分布和超限次数
- [x] 5.3 分别上传 95 MB 和 105 MB 请求体，验证 95 MB 写入 Durable Object 后大小和校验值一致，105 MB 返回 413
- [x] 5.4 在一次已认证的请求内逐个复制并删除 Durable Object 中的对象，直到触发平台限制或达到测量上限，验证结论文档记录了最大对象数和建议的同步处理上限
- [x] 5.5 发送一次携带 API Key 的目录 PROPFIND 探测请求，验证结论文档记录了 D1 读写行数和 Durable Object 读写行数
- [x] 5.6 在 Durable Object 内逐级增加单次请求的 CPU 负载，验证结论文档记录了成功完成的最大 CPU 时间和超限时的表现，并判断 30 秒上限在 Free 上是否成立；不成立时列出方案交给用户决定
- [x] 5.7 删除探测 Worker、Durable Object 命名空间和 D1 测试数据库，用 `wrangler` 列出资源，验证这些资源已经不存在

## 6. 结论和 PRD 同步

- [x] 6.1 完成 `docs/architecture/phase-0-findings.md`，验证 PRD Phase 0 验证清单的 12 项都有结果、证据和依赖版本
- [x] 6.2 把 Elysia 起步版本和目录 COPY/MOVE 同步处理上限写回 `prd.md`，需要改变选型或安全参数的项先由用户决定，验证 PRD 中不再有对应的待定项
- [x] 6.3 运行 `bun run check` 和兼容性测试命令，验证在没有 Cloudflare 凭据的环境下都以状态 0 退出

## Workflow follow-up

- Linear 项目 davloom 的子任务 MAR-91 到 MAR-120 与上面的任务同编号，任务状态变化时同步。例外：5.6 是后加的，对应 MAR-121，原来的 5.6 改为 5.7，仍是 MAR-117。
- 用户审阅结论文档后，归档这个 change。
- 归档后确认 `openspec/specs/` 下生成了 4 个 capability 的 spec。
