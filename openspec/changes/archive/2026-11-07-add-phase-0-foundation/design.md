# Design

## Context

仓库目前只有 `prd.md` 和 OpenSpec 配置，没有任何代码。动机和范围见 proposal.md，行为要求见 specs。

下面是 2026-11-06 在 npm 上查到的 `latest` 版本，项目依赖都用这个标签上的版本。它们只来自包的元数据，实际组合是否可用正是这个 change 要验证的。

| 依赖 | 版本 | 备注 |
| --- | --- | --- |
| `@astryxdesign/core` | 0.7.8 | peer 依赖 React 19 和 StyleX `^0.19.0` |
| `@stylexjs/unplugin` | 0.19.1 | peer 依赖 `unplugin` `^2.3.11`，所以 `unplugin` 不能用最新的 3.x |
| `@tanstack/react-start` | 1.169.4 | 要求 Vite 8 以上 |
| `elysia` | 1.4.31 | `rc` 标签是 `2.0.0-rc.3`；Workers 适配器标为 experimental |
| `effect` | 4.1.2 | |
| `better-auth`、`@better-auth/api-key` | 1.7.18 | peer 依赖 `drizzle-orm` `^0.45.2`，或 1.0 RC 及以上 |
| `drizzle-orm` | 0.45.4 | 1.0 只有 beta 标签 |
| `typescript` | 7.0.2 | 自带原生 `tsc`。`@typescript/native-preview` 从 2026-07-07 起没有更新，不再使用 |

## Goals / Non-Goals

**Goals:**

- 骨架代码放在 PRD 第 10 节规定的位置，后续 Phase 直接沿用。
- 依赖升级时可以重跑同一套兼容性测试。

**Non-Goals:**

- 不做 Storage Port 和 Adapter。探测入口直接使用 Durable Object binding，只为测量平台限制。
- 不实现 WebDAV 协议语义。探测入口的处理器只回显请求信息。
- 不为通过实测而修改选型或调低安全参数。

## Decisions

### 1. 探测代码使用单独入口

生产入口只注册 `/api/health` 和返回 501 的 `/dav/*`。探测入口放在 `tests/integration/compat/probe`，复用同一个应用工厂，注入回显处理器，并加上认证、Durable Object 直通和目录操作等探测路由。探测 Worker 部署到公网时要求一次性令牌，实测后删除。

备选方案：

- 独立的临时仓库：测试无法随依赖升级重跑。
- 在生产入口用开关控制：探测路由有泄露到生产环境的风险。

### 2. Elysia 从 1.4 起步，用 2.0 RC 做对照

先用 1.4.x 跑完全部传输层测试，再用 `2.0.0-rc.3` 跑同一套测试。判定规则：

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

### 6. 测试分四层

| 层 | 工具 | 运行条件 |
| --- | --- | --- |
| 传输和探测 | Vitest on Node，启动真实的 Bun 进程和 `wrangler dev`（workerd），通过 HTTP 访问 | 本地，不需要账号 |
| 数据库和身份 | Vitest + `@cloudflare/vitest-plugin`（D1），Vitest on Bun（Bun SQLite） | 本地，不需要账号 |
| UI | Playwright，针对生产构建 | 本地，不需要账号 |
| Cloud Free 实测 | 脚本 + 真实部署 | 需要 Cloudflare 账号，未配置探测地址时跳过 |

传输层不放进 `@cloudflare/vitest-plugin` 的测试池，实施时试过两种方式都不可行：

- 测试池在请求上下文里才加载 main Worker，这时 Elysia 的 `.compile()` 生成代码会抛 `EvalError`。真实的 Workers 在启动阶段执行这段代码，`wrangler dev` 上没有这个问题。
- 把构建产物配置成辅助 Worker 时，1.6.0 版本的插件连最简单的脚本都启动失败，报 workerd 内部错误。

真实进程加 HTTP 反而更接近生产：启动过程、请求解析和流式传输都和部署后一致。

HTTP 测试要在 Node 上运行。在 `bun --bun` 下，子进程拿到的 `node` 实际是 Bun，而 `wrangler dev` 在 Bun 上无法转发请求，会返回 503。

本地 Workers 运行时不施加 Free 套餐的 CPU 和请求体限制，这些数据只能来自真实部署。实测用例可以用 `test:cloud:local` 在本地 workerd 上空跑，只用来确认流程，不产生实测数据。

### 7. Cloud Free 默认用 Durable Objects 存文件内容

2026-11-06 用户决定 Cloud Free 不绑卡也要能用，默认组合是 Workers + D1 + Durable Objects：D1 存元数据，SQLite 后端的 Durable Object 存文件内容。R2 和 S3 兼容服务是用户可选的后端，不使用 MinIO 和 KV。第 5 组因此改测 Durable Objects。

探测用的表把路径和文件分块分开，每个分块 1 MiB，低于 2 MB 的行大小上限。Worker 把请求流原样转发给对象，自己不碰字节，这样 CPU 消耗落在对象一侧。

最关键的未知数是对象的 CPU 上限。[官方限制页](https://developers.cloudflare.com/durable-objects/platform/limits/)写每个请求 30 秒，这一行没有区分套餐，但同一页又写 Workers 的限制也适用，所以只有真实部署能回答，这是任务 5.6 的目的。不成立时退回把分块转成 base64 存入 D1，单文件上限会小很多，由用户决定。

备选方案：

- R2：[开通要先走结账流程](https://developers.cloudflare.com/r2/get-started/)，超额按量计费，做不到“不绑卡、不会产生账单”。保留为可选后端。
- D1 存二进制：workerd 的 D1 客户端把 BLOB 转成 JS 数组再做 JSON 序列化。在本机用 Node 估算，写 1 MiB 约 19 ms，超过 Free 的 10 ms。
- KV：Free 总共 1 GB，每天写 1000 次，而且最终一致，WebDAV 客户端可能读不到刚写入的文件。

## Cloudflare Workers 和 Bun 的差异

| 方面 | Cloudflare Workers | Bun |
| --- | --- | --- |
| 入口 | `fetch` 导出，使用 Elysia 的 Cloudflare 适配器并调用 `.compile()` | `Bun.serve`，Elysia 原生支持 |
| 资源来源 | D1 和 Durable Object binding，请求时传入 | 环境变量和本地 SQLite 文件 |
| 数据库 | D1，不支持交互式事务 | Bun SQLite，同步驱动 |
| 请求体上限 | 由域名套餐决定，Free 和 Pro 为 100 MB | 由 `maxRequestBodySize` 控制，需要调高 |
| CPU | Free 每个 HTTP 请求 10 ms，Durable Object 文档写 30 秒（待实测） | 没有平台限制 |
| 子请求 | Free 单次调用 50 次外部、1000 次内部，D1 查询 50 次 | 没有平台限制 |
| 每日配额 | Free 请求 10 万次；D1 和 Durable Object 各读 500 万行、写 10 万行 | 没有平台限制 |
| Dashboard 静态资源 | Workers 静态资源 | 由应用进程提供 |

## Risks / Trade-offs

- [管理员密码登录在 Workers Free 上超过 10 ms CPU] → Cloudflare 文档提到认证类负载通常需要 10–20 ms。实测记录数据；超限时在结论文档列出方案，由用户决定，不调低哈希强度。
- [每次 API Key 验证都写数据库，快速消耗 D1 免费额度] → 测量单次请求的读写次数，必要时在 Phase 3 设计缓存或关闭相关写入。
- [Durable Object 在 Free 上没有 30 秒 CPU] → 任务 5.6 实测；不成立时列出数据和方案，由用户决定，选型在决定之前不变。
- [实测本身消耗每日配额] → Durable Object 每天只能写 10 万行，删除也算写入，所以任务 5.4 设了对象数上限。多次重跑要隔到 UTC 零点之后。
- [Astryx 0.x 的 API 变动] → 固定精确版本，升级时重跑兼容性测试。
- [Elysia 的 Workers 适配器不稳定] → 处理入口不依赖 Elysia（决定 4）。
- [实测需要真实账号，无法进入本地测试] → 实测脚本化，依赖版本记入结论文档，升级后人工重跑。
- [实测使用 `workers.dev` 子域名，正式域名的套餐可能不同] → 结论文档注明测试域名，产品文档按 Free 套餐的上限写。

## Migration Plan

没有存量数据和部署，回滚只需回退提交。云端资源只有探测 Worker 和测试数据，实测结束后删除。
