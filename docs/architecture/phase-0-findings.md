# Phase 0 兼容性结论

记录 PRD 第 13 节 Phase 0 验证清单的结果。OpenSpec change：`add-phase-0-foundation`。

本地验证和 Cloud Free 实测都已完成。

## 环境

本地测试在 macOS（Apple Silicon）上运行，Bun 1.4.4，Node 26.12.0，workerd 由 `wrangler dev` 启动。浏览器用的是本机缓存的 Chromium headless shell 1243，不是 Playwright 1.64.1 对应的 1248。除非另有说明，文中的依赖版本都是 2026-11-06 npm 上 `latest` 标签的版本。Cloud Free 实测部署到 workers.dev，账号是 Workers Free。

下面是 `bun run test:compat` 的结果。运行时把 `XDG_CONFIG_HOME` 指向空目录，Wrangler 处于未登录状态；`bun run check` 和这条命令都以状态 0 退出。

| 测试层                               | 命令               | 结果             |
| ------------------------------------ | ------------------ | ---------------- |
| 传输和探测（Bun、workerd）           | `test:http`        | 111 通过         |
| 身份（D1）                           | `test:d1`          | 6 通过           |
| 身份（Bun SQLite）                   | `test:bun-sqlite`  | 6 通过           |
| UI（Bun 和 Workers 两种交付）        | `test:ui`          | 43 通过，1 跳过  |
| 改品牌色后重新构建                   | `test:ui:brand`    | 4 通过           |
| Cloud Free 流程在本地 workerd 上空跑 | `test:cloud:local` | 34 通过，1 跳过  |
| Cloud Free 实测，未配置部署          | `test:cloud`       | 11 通过，24 跳过 |

UI 跳过的是“缺失的静态资源返回 404”，这条只适用于 Bun。空跑跳过的是 105 MB 用例，本地没有请求体上限。

## 验证清单

| #   | 验证项                                          | 结果                                         | 证据                                                                                                                                                                            | 依赖版本                                                      |
| --- | ----------------------------------------------- | -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------- |
| 1   | Elysia + Effect on Cloudflare Workers           | 本地 workerd 和真实部署都通过                | `http/effect.test.ts`：成功、已声明错误和未预期缺陷的响应在 Bun 和 workerd 上一致；workers.dev 上的探测 Worker 通过全部 35 个用例                                               | `elysia` 1.4.31、`effect` 4.1.2、`wrangler` 4.158.0           |
| 2   | Better Auth + D1 / SQLite                       | 通过                                         | `identity/d1.test.ts`、`identity/bun-sqlite.test.ts`、`http/basic-auth.test.ts`                                                                                                 | `better-auth` 1.7.18、`drizzle-orm` 0.45.4                    |
| 3   | TanStack Start + React 19                       | 通过                                         | SPA 生产构建，`ui/delivery.spec.ts` 在两种交付方式下直接打开深层路由                                                                                                            | `@tanstack/react-start` 1.169.4、`react` 19.3.1、`vite` 8.3.6 |
| 4   | Astryx 组件与 TanStack Start 的集成             | 通过                                         | `ui/interactions.spec.ts`：键盘操作 Dialog 和 Menu，焦点回到触发元素，控制台没有错误                                                                                            | `@astryxdesign/core` 0.7.8                                    |
| 5   | StyleX Vite 编译                                | 通过                                         | `ui/styles.spec.ts` 在生产构建上读到自有组件的计算样式                                                                                                                          | `@stylexjs/stylex`、`@stylexjs/unplugin` 0.19.1               |
| 6   | Astryx Theme 与 Dark Mode                       | 通过                                         | `ui/appearance.spec.ts`、`scripts/verify-brand-change.ts`。去掉 head 脚本后，首次绘制的用例会失败                                                                               | `@astryxdesign/core`、`@astryxdesign/theme-neutral` 0.7.8     |
| 7   | Cloudflare Free 的 CPU 和请求开销，覆盖认证链路 | 通过，没有请求超限                           | workers.dev 上 100 次携带 API Key 的请求和 20 次登录全部成功，CPU 分布和行数见“Cloud Free 实测”                                                                                 | 同第 1、2 项                                                  |
| 8   | Durable Objects 在 Free 上的 CPU 上限和文件写入 | 通过，30 秒上限成立                          | 95 MB 写入后读回，SHA-256 一致；CPU 用到 32.3 秒的请求完成，更长的请求在约 30.2 秒时被重置                                                                                      | `wrangler` 4.158.0                                            |
| 9   | WebDAV 方法穿过 Elysia、Workers 和 Bun          | 本地和真实部署都通过                         | `http/echo.test.ts`、`http/production.test.ts`；workers.dev 上 12 个方法和 WebDAV 请求头原样到达                                                                                | `elysia` 1.4.31                                               |
| 10  | PUT 和 GET 全程流式                             | 通过                                         | `http/streaming.test.ts`、`http/large-upload.test.ts`。故意改成缓冲后，内存增量是 1918 MiB，这两组测试都会失败。workers.dev 上 95 MB 经 Worker 写入和读回，Worker 只用 4 ms CPU | Bun 1.4.4、`elysia` 1.4.31                                    |
| 11  | 目录 COPY/MOVE 的同步处理上限                   | 确定：Durable Objects 1000 个对象，R2 400 个 | 一次请求内复制并删除 2000 个对象，没有碰到平台限制；R2 按文档估算                                                                                                               | 同第 8 项                                                     |
| 12  | Elysia 起步版本                                 | 确定为 1.4                                   | 见下一节                                                                                                                                                                        | `elysia` 1.4.31、`2.0.0-rc.3`                                 |

## Elysia 版本对照

传输层测试（`tests/integration/compat/http`，共 111 个用例）在两个版本上的结果：

| 版本                 | Bun      | Workers（本地 workerd） | 1 GiB 上传的内存增量（Bun） |
| -------------------- | -------- | ----------------------- | --------------------------- |
| `1.4.31`（`latest`） | 全部通过 | 全部通过                | 20–40 MiB，多次运行的范围   |
| `2.0.0-rc.3`（`rc`） | 全部通过 | 全部通过                | 20–38 MiB，多次运行的范围   |

结论：按 design 的判定规则，起步版本采用 1.4。重跑命令是 `bun run test:http:elysia-rc`，它在 `tests/integration/compat` 目录下运行，结束后恢复依赖和源码。

迁移到 2.0 要改两处，脚本 `tests/integration/compat/scripts/rerun-with-elysia.ts` 里有对应的替换：

- 路由钩子的参数位置改了：`.all(path, handler, hook)` 变为 `.all(path, hook, handler)`，旧顺序在启动时直接抛错。
- `elysia/adapter/cloudflare-worker` 不再存在，Workers 入口改用 `elysia/adapter/web-standard`。

## 流式传输的内存占用（Bun）

下面是用 `Bun.serve` 单独做的一次性测量，没有经过 Elysia，脚本没有进入仓库。读取方变慢时内存没有膨胀，说明 Bun 对请求体和响应体都有背压。

| 场景          | 读取方延迟        | 启动后常驻内存 | 结束时高水位 |
| ------------- | ----------------- | -------------- | ------------ |
| 上传 1024 MiB | 无                | 8 MiB          | 39 MiB       |
| 上传 512 MiB  | 每次读取后等 5 ms | 8 MiB          | 32 MiB       |
| 下载 1024 MiB | 无                | 6 MiB          | 69 MiB       |
| 下载 256 MiB  | 每次读取后等 2 ms | 5 MiB          | 20 MiB       |

## Cloud Free 实测

2026-11-06 在 Workers Free 账号上运行，套餐由用户在 Dashboard 确认。运行命令：

```bash
bun run --filter @davloom/compat-tests cloud:free all
```

它用 Wrangler 当前登录的账号创建一个 D1 数据库，部署带一次性令牌的探测 Worker，测完后删除 Durable Object 数据、Worker 和数据库，再用列表确认。一次运行写入约 31,000 行 Durable Object 数据，约为当天配额的三分之一。CPU 数据来自 `wrangler tail`，原始结果在 [phase-0-cloud-free-results.json](phase-0-cloud-free-results.json)。

第一次运行在测量开始前失败，原因见“测试发现并修复的问题”。清理照常完成，几乎没有消耗配额。修复后的第二次运行 35 个用例全部通过，用时 373 秒。

### 部署

| 项目           | 结果                                      |
| -------------- | ----------------------------------------- |
| 上传体积       | 3642.50 KiB，gzip 后 646.44 KiB           |
| 启动时间       | 两次部署分别是 76 ms 和 119 ms，上限 1 秒 |
| 没有令牌的请求 | 404                                       |

### Worker 的 CPU

| 请求                     | 次数 | 结果     | CPU（tail 收到的样本）                      |
| ------------------------ | ---- | -------- | ------------------------------------------- |
| 携带 API Key 的 PROPFIND | 100  | 全部 200 | 6 个样本：p50 3 ms，最大 24 ms              |
| Worker 里的管理员登录    | 20   | 全部 200 | 12 个样本：p50 63 ms，p90 80 ms，最大 94 ms |
| 逐级增加 CPU 负载        | 36   | 全部 200 | 最高 1134 ms                                |

文档写的 Workers Free 上限是每个请求 10 ms，超限返回 1102。这次没有一个请求被拦截，用了 1134 ms 的请求也正常返回。这种宽松没有写进文档，设计仍按 10 ms 留余量。

`wrangler tail` 没有收到全部事件：100 次 API Key 请求只收到 6 条，20 次登录只收到 12 条，所以上表的 CPU 分布只代表这些样本。Durable Object 的调用也会出现在 tail 里。

### Durable Object

| 项目                     | 结果                                                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| 对象里的管理员登录，5 次 | 全部 200。对象 CPU p50 75 ms，最大 117 ms；负责转发的 Worker 用 0 ms                                                                              |
| 写入 95 MB               | 200，91 个分块，写 185 行。客户端 11.8 秒，Worker CPU 4 ms，对象 CPU 937 ms                                                                       |
| 读回 95 MB               | 200，4.4 秒，SHA-256 与写入时一致                                                                                                                 |
| 上传 105 MB              | 413                                                                                                                                               |
| 逐级增加 CPU 负载        | 用了 32,278 ms 的请求完成，墙钟 35.2 秒；下一个请求在 30,221 ms 时被重置，返回 502 和 `Durable Object exceeded its CPU time limit and was reset.` |

30 秒的 CPU 上限在 Free 上成立。截断点并不精确，有一个请求到 32.3 秒才结束，所以设计按 30 秒计算。

### 行数

真实部署上的行数和本地 workerd 的基线完全一致：

| 操作                     | D1                         | Durable Object   |
| ------------------------ | -------------------------- | ---------------- |
| 一次携带 API Key 的请求  | 3 次查询，读 5 行，写 2 行 | 不涉及           |
| 列出有 100 个子项的目录  | 不涉及                     | 读 100 行        |
| 写入 95 MB，共 91 个分块 | 不涉及                     | 写 185 行        |
| 创建 1 个对象            | 不涉及                     | 写 5 行          |
| 复制并删除 1 个对象      | 不涉及                     | 读 7 行，写 7 行 |

按这些数字，D1 每天 10 万行的写入配额只够 5 万次携带 API Key 的请求，比 Workers 每天 10 万次请求的上限先用完。Durable Object 的写入配额够每天复制并删除约 14,000 个对象。

### 目录 COPY/MOVE 的同步处理上限

在一次已认证的请求里，于对象内逐个复制并删除 1 KiB 的对象：

| 对象数 | 结果 | 对象 CPU | 写入行数 | 客户端耗时 |
| ------ | ---- | -------- | -------- | ---------- |
| 100    | 200  | 5 ms     | 700      | 106 ms     |
| 400    | 200  | 14 ms    | 2,800    | 165 ms     |
| 2,000  | 200  | 91 ms    | 14,000   | 261 ms     |

到测量上限 2000 个也没有碰到平台限制。真正的约束是每天 10 万行的写入配额，一次处理 2000 个对象就用掉 14%。

用户在 2026-11-06 定下的上限：

- Durable Objects 一次最多 1000 个对象，约写 7000 行，占每天写入配额的 7%。
- R2 一次最多 400 个对象。R2 要绑定支付方式才能开通，不在这轮实测内。Free 上每个请求最多 1000 次内部子请求，R2 的调用也算在内。复制一个对象要读一次、写一次，移动再加上可以批量执行的删除，剩下的次数留给认证和列目录。开通 R2 后要实测确认。

### 清理

两次运行都依次删除了 Durable Object 命名空间（部署带 `state: "deleted"` 的配置）、Worker 和 D1 数据库，然后用 `wrangler` 列出资源，确认 Worker 和数据库都已不存在。wrangler 没有列出 Durable Object 命名空间的命令，命名空间的删除以那次部署成功为准。

## 测试发现并修复的问题

- Bun 上的 `GET` 和 `HEAD /dav/*` 曾经返回 404。Elysia 优先匹配具体方法的路由，`.get("/*")` 的 Dashboard 路由压过了 `.all("/dav/*")`。现在 Dashboard 路由用 `.all("/*")`。
- Bun 上的 `/%00` 曾经返回 500，因为 `Bun.file` 遇到空字节会抛错。现在返回 404。
- Workers 上的 `/api` 曾经落到 SPA 返回 200。现在 `run_worker_first` 包含 `/api`，返回 API 自己的 404。
- Cloud Free 实测的 `beforeAll` 曾经调用 `expect.poll()`，Vitest 只允许在测试里调用它。这段代码只在真实部署时运行，本地空跑发现不了，第一次实测因此在测量前失败。现在改用 `cloud/tail.ts` 的 `pollUntil`，tail 连不上时带着 wrangler 的报错停止，不再消耗配额。

## 两种交付方式的差异

| 请求                    | Bun | Workers 静态资源       |
| ----------------------- | --- | ---------------------- |
| 缺失的 `/assets/x.js`   | 404 | 200，返回 `index.html` |
| `/design-check` 的 POST | 405 | 405                    |

第一行来自 SPA 回退：`not_found_handling` 对所有未命中的路径都返回 `index.html`。这不影响功能，只是缺失的资源在 Workers 上不会显示成 404。

## 后续动作

- Phase 2：裸路径 `/dav` 现在返回 404，spec 只覆盖 `/dav/`。接入真实 WebDAV 客户端时要决定是否让它进入处理入口。
- Phase 3：决定是否关闭 API Key 验证的写入，或者加缓存，原因见上面的配额估算。
- Phase 3：Worker 里的管理员登录用 63–94 ms CPU，远超文档写的 10 ms。Free 这次没有拦截，但文档没有承诺。到时由用户决定把密码校验放进 Durable Object（实测 75–117 ms，在 30 秒上限内），还是留在 Worker；哈希强度不变。
- Phase 4：示例页 `/design-check` 现在在生产构建里，要在正式页面完成前移除或隐藏。
- Phase 4：主题没有加载 `@astryxdesign/theme-neutral` 的 `fonts.css`（它从 Google Fonts 加载字体），字体回退到系统字体。到时决定是否加载或自托管字体。
- `bun pm untrusted` 列出 `@astryxdesign/core` 和 `@astryxdesign/cli` 的 postinstall 被拦截。没有运行它们，所有测试都通过。
- `wrangler tail` 只收到部分事件。以后需要完整的 CPU 分布时，改用 Workers Logs 或 Tail Worker。
