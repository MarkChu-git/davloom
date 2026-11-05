# Design

## Context

仓库目前只有 `prd.md` 和 OpenSpec 配置，没有任何代码。动机和范围见 proposal.md，行为要求见 specs。

下面是 2026-11-04 在 npm 上查到的版本。它们只来自包的元数据，实际组合是否可用正是这个 change 要验证的。

| 依赖 | 版本 | 备注 |
| --- | --- | --- |
| `@astryxdesign/core` | 0.7.6 | peer 依赖 React 19 和 StyleX `^0.19.0` |
| `@stylexjs/unplugin` | 0.19.1 | |
| `@tanstack/react-start` | 1.169.4 | 要求 Vite 8 以上 |
| `elysia` | 1.4.30 | 另有 `2.0.0-rc.1`；Workers 适配器标为 experimental |
| `effect` | 4.1.2 | |
| `better-auth`、`@better-auth/api-key` | 1.7.15 | peer 依赖 `drizzle-orm` `^0.45.2` |
| `drizzle-orm` | 0.45.4 | |

## Goals / Non-Goals

**Goals:**

- 骨架代码放在 PRD 第 10 节规定的位置，后续 Phase 直接沿用。
- 依赖升级时可以重跑同一套兼容性测试。

**Non-Goals:**

- 不做 Storage Port 和 Adapter。探测入口直接使用 R2 binding，只为测量平台限制。
- 不实现 WebDAV 协议语义。探测入口的处理器只回显请求信息。
- 不为通过实测而修改选型或调低安全参数。

## Decisions

### 1. 探测代码使用单独入口

生产入口只注册 `/api/health` 和返回 501 的 `/dav/*`。探测入口放在 `tests/integration/compat/probe`，复用同一个应用工厂，注入回显处理器，并加上认证、R2 直通和目录操作等探测路由。探测 Worker 部署到公网时要求一次性令牌，实测后删除。

备选方案：

- 独立的临时仓库：测试无法随依赖升级重跑。
- 在生产入口用开关控制：探测路由有泄露到生产环境的风险。

### 2. Elysia 从 1.4 起步，用 2.0 RC 做对照

先用 1.4.x 跑完全部传输层测试，再用 `2.0.0-rc.1` 跑同一套测试。判定规则：

- 1.4 通过：采用 1.4，RC 的结果记入结论文档。
- 1.4 不通过、RC 通过：把切换到 2.0 作为结论提交用户决定。
- 两者都不通过：记录失败数据，由用户决定是否更换 HTTP 框架。

备选方案是直接用 RC，但 RC 和 experimental 适配器叠加时，出问题很难定位原因。

### 3. Dashboard、API 和 WebDAV 同源

`/dav/*` 交给 WebDAV，`/api/*` 交给 REST API，其余路径交给 Dashboard。同源让 Session Cookie 不需要跨域配置，也不需要 CORS。

备选方案是给 WebDAV 单独的子域名，但自托管用户要多配一套 DNS 和证书。如果 Phase 2 发现客户端有路径兼容问题，再调整这个约定。

### 4. WebDAV 处理入口只依赖 Web 标准类型

`/dav/*` 路由关闭 Elysia 的 body 解析，把 `Request` 交给 `packages/webdav` 的处理入口，处理入口返回 `Response`。这样协议引擎可以脱离 HTTP 框架测试，更换框架的改动也限于 `apps/api`。

备选方案是使用 Elysia 的路由参数和 body schema，但路由参数会解码路径，body 解析会读取请求体，与 `webdav-transport` 的要求冲突。

### 5. Effect Runtime 在 isolate 内缓存

应用工厂接收一个环境对象，里面是该运行时提供的数据库和存储句柄。Workers 的 binding 通过请求入口传入，全局作用域不能做 I/O，所以首次请求时构建 Effect Runtime 并缓存在 isolate 内。Bun 在启动时构建一次。

备选方案是每个请求重建 Layer。实现更简单，但每个请求都要多花 CPU，而 Cloud Free 只有 10 ms。

### 6. 测试分三层

| 层 | 工具 | 运行条件 |
| --- | --- | --- |
| 运行时兼容 | Vitest + `@cloudflare/vitest-plugin`、Vitest on Bun | 本地，不需要账号 |
| UI | Playwright，针对生产构建 | 本地，不需要账号 |
| Cloud Free 实测 | 脚本 + 真实部署 | 需要 Cloudflare 账号，未配置探测地址时跳过 |

本地 Workers 运行时不施加 Free 套餐的 CPU 和请求体限制，这些数据只能来自真实部署。

## Cloudflare Workers 和 Bun 的差异

| 方面 | Cloudflare Workers | Bun |
| --- | --- | --- |
| 入口 | `fetch` 导出，使用 Elysia 的 Cloudflare 适配器并调用 `.compile()` | `Bun.serve`，Elysia 原生支持 |
| 资源来源 | D1 和 R2 binding，请求时传入 | 环境变量和本地 SQLite 文件 |
| 数据库 | D1，不支持交互式事务 | Bun SQLite，同步驱动 |
| 请求体上限 | 由域名套餐决定，Free 和 Pro 为 100 MB | 由 `maxRequestBodySize` 控制，需要调高 |
| CPU | Free 每个 HTTP 请求 10 ms | 没有平台限制 |
| 子请求 | Free 单次调用 50 次外部、1000 次内部 | 没有平台限制 |
| Dashboard 静态资源 | Workers 静态资源 | 由应用进程提供 |

## Risks / Trade-offs

- [管理员密码登录在 Workers Free 上超过 10 ms CPU] → Cloudflare 文档提到认证类负载通常需要 10–20 ms。实测记录数据；超限时在结论文档列出方案，由用户决定，不调低哈希强度。
- [每次 API Key 验证都写数据库，快速消耗 D1 免费额度] → 测量单次请求的读写次数，必要时在 Phase 3 设计缓存或关闭相关写入。
- [Astryx 0.x 的 API 变动] → 固定精确版本，升级时重跑兼容性测试。
- [Elysia 的 Workers 适配器不稳定] → 处理入口不依赖 Elysia（决定 4）。
- [实测需要真实账号，无法进入本地测试] → 实测脚本化，依赖版本记入结论文档，升级后人工重跑。
- [实测使用 `workers.dev` 子域名，正式域名的套餐可能不同] → 结论文档注明测试域名，产品文档按 Free 套餐的上限写。

## Migration Plan

没有存量数据和部署，回滚只需回退提交。云端资源只有探测 Worker 和测试数据，实测结束后删除。
