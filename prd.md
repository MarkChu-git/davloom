# Davloom — 产品与技术开发总计划

**版本：** v1.2  
**日期：** 2026 年 11 月 4 日  
**类型：** Open-source · Self-hosted · WebDAV · Cloud Storage  
**产品口号：** *Your storage. Your rules.*  
**架构原则：** Cloudflare-first, Vendor-neutral by design.

---

## 1. 产品定位

Davloom 是一个开源、现代化、可自托管的 WebDAV 文件存储平台。

用户可以将 Cloudflare R2、AWS S3、MinIO 等 S3-compatible 对象存储转换为标准 WebDAV 服务，同时使用现代化 Web Dashboard 进行文件、账户、凭据和存储管理。

### 核心原则

- **Free-first：** 优先支持 Cloudflare 免费套餐。
- **Vendor-neutral：** 不依赖单一云厂商的专有运行能力。
- **Self-hostable：** 支持 Docker、Bun、SQLite。
- **WebDAV-first：** 协议正确性优先。
- **Type-safe：** TypeScript + Effect Schema + Drizzle。
- **Secure-by-default：** 默认私有存储、最小权限。
- **Portable：** 支持配置、数据库和文件数据迁移。
- **Agent-friendly：** 代码结构、组件规范和文档便于 AI Coding Agent 理解。

### 目标用户

1. 需要使用 WebDAV 同步配置的开发者。
2. 希望低成本使用 Cloudflare R2 的个人用户。
3. 拥有 NAS、Home Server 或 VPS 的自托管用户。
4. 希望统一管理不同 S3-compatible 存储的用户。

V1 不定位为 Nextcloud 的完整替代品，主要解决 WebDAV、文件管理和存储可移植性。

---

## 2. 完整技术栈

### 前端与 UI

| 类别 | 选型 |
|---|---|
| Programming Language | TypeScript |
| Frontend Framework | React 19+ |
| Full-stack Framework | TanStack Start |
| Router | TanStack Router |
| Server State | TanStack Query |
| Client State | TanStack Store |
| UI Design System | **Meta Astryx** |
| Styling | **Meta StyleX** |
| Theme | Astryx Theme System |
| Design Tokens | CSS Custom Properties + StyleX |
| Large List Virtualization | TanStack Virtual |
| Icons | Lucide |
| Build Tool | Vite |
| Styling Integration | @stylexjs/unplugin |
| UI Testing | Vitest + Playwright |

**不再将 Tailwind CSS、shadcn/ui、Radix UI 列为项目基础依赖。**

Astryx 提供 React 组件、布局原语、主题和交互能力；StyleX 负责 Davloom 自有组件的样式。

对于复杂文件管理组件，可以在 Astryx 基础上组合 TanStack Table、TanStack Virtual 和自有交互逻辑。

### 后端与领域逻辑

| 类别 | 选型 |
|---|---|
| HTTP Framework | ElysiaJS |
| Business Framework | Effect v4 |
| Dependency Injection | Effect Context / Layer |
| Validation | Effect Schema |
| Error Handling | Effect Typed Errors |
| Typed API Client | Eden Treaty |
| API Documentation | OpenAPI |
| WebDAV Protocol | RFC 4918 |
| XML Parsing | saxes |
| Streaming | Web Streams API |
| Cryptography | Web Crypto API |

Elysia 负责 HTTP 入口，Effect 负责业务编排。两者职责不重叠。

### 身份与权限

| 类别 | 选型 |
|---|---|
| Authentication | Better Auth |
| ORM Adapter | Drizzle |
| Sessions | Better Auth |
| API Credentials | Better Auth API Key |
| Admin Management | Better Auth Admin |
| MFA | Better Auth Two-Factor |
| WebDAV Authentication | Basic Auth + API Key Adapter |
| Authorization | Effect Policy Service |

统一由 Better Auth 管理身份，但文件路径和 Mount 权限由 Effect 决策。

### 数据与存储

| 类别 | 选型 |
|---|---|
| ORM | Drizzle ORM |
| Migration | Drizzle Kit |
| SQL Dialect | SQLite |
| Cloud Database | Cloudflare D1 |
| Self-hosted Database | Bun SQLite |
| Cloud Storage | Cloudflare R2 |
| Generic Storage | S3-compatible API |
| Storage SDK | AWS SDK S3 Client |
| Native Optimization | R2 Binding |
| File Locks | SQL-backed LockService |
| Optional Coordination | Durable Objects |

### 工程质量

| 类别 | 选型 |
|---|---|
| Package Manager | Bun |
| Monorepo | Bun Workspaces |
| Linter | Oxlint |
| Formatter | Oxfmt |
| Type Check | TypeScript / tsgo |
| Unit Tests | Vitest |
| Workers Integration | @cloudflare/vitest-plugin |
| E2E | Playwright |
| CI/CD | GitHub Actions |
| Security | CodeQL + Dependency Review |
| Release | Changesets |
| Container | Docker + Docker Compose |
| Spec Workflow | OpenSpec |
| Issue Tracking | Linear |
| Code Intelligence | GitNexus |

---

## 3. Astryx + StyleX 设计规范

### 3.1 组件策略

Davloom 使用 Astryx 作为 UI 基础，而不是开发另一套通用组件库。

优先使用：

- Astryx Button、Input、Dialog、Menu 等交互组件。
- Astryx Layout、Stack、Grid 等布局能力。
- Astryx 表单、导航和通知组件。
- Astryx 现有设计令牌和主题系统。
- 自定义 StyleX 样式用于 Davloom 专属组件。

不重复实现 Astryx 已经提供的通用组件。

### 3.2 主题设计

默认采用 `@astryxdesign/theme-neutral`。

在此基础上定义 **Davloom Theme**：

- Brand Colors
- Typography
- Border Radius
- Spacing
- Surface Colors
- Semantic Colors
- Light / Dark Mode

通过 Astryx Theme System 和 CSS Custom Properties 管理主题。

不直接修改 Astryx 依赖中的源代码。

### 3.3 StyleX 使用规则

所有新开发的应用级组件优先使用 StyleX。

约定：

- 使用 `stylex.create()` 定义组件样式。
- 使用 `stylex.props()` 组合样式。
- 尽量使用 Astryx Design Tokens。
- 避免随意使用内联 Style。
- 避免在业务组件中引入第二套 CSS-in-JS。
- 不依赖 Astryx 内部生成的 Class Name。

### 3.4 构建方式

Astryx 使用官方预编译 CSS。

Davloom 自己编写的 StyleX 由 Vite Plugin 编译。

保留 Astryx 官方 CSS Layer 与主题顺序，避免因为重复编译造成 CSS 冲突。

### 3.5 避免 UI Vendor Lock-in

虽然 Astryx 是开源设计系统，但 UI 仍存在技术依赖。

因此：

- 业务状态不得与 Astryx 组件内部实现耦合。
- 文件操作、权限、数据请求不放在通用 UI 组件中。
- 自定义业务组件通过明确的 Props 接收数据和操作。
- 主题基于可导出的 Design Tokens。
- 对需要深度定制的组件，可以使用 Astryx Swizzle 获取源码并自行维护。
- 固定经过测试的 Astryx 版本，避免 Beta API 更新破坏应用。

不为了抽象而包装每一个 Astryx Button。仅在业务组件边界建立稳定接口。

### 3.6 AI Agent 开发规范

使用 Astryx CLI 获取官方组件资料，并在项目 `AGENTS.md` 中纳入组件使用规范。

AI Coding Agent 必须优先搜索 Astryx 现有组件，不能随意重复创建 UI 原语。

项目中的设计示例、主题变量和组件用法需要有统一文档。

---

## 4. 系统架构

采用 **Hexagonal Architecture + Effect Layer**。

### Presentation Layer

- TanStack Start Dashboard
- Elysia REST API
- Elysia WebDAV HTTP Adapter

### Application Layer

- FileService
- DirectoryService
- TransferService
- MountService
- CredentialService
- PermissionService

### Domain Layer

- WebDAV Protocol Engine
- Storage Port
- Database Port
- Lock Port
- Effect Schema
- Domain Errors
- Authorization Policies

### Infrastructure Layer

- Cloudflare R2 Adapter
- Generic S3 Adapter
- Cloudflare D1 Adapter
- SQLite Adapter
- SQL Lock Adapter
- Cloudflare Workers Runtime
- Bun Runtime

### 依赖规则

1. Domain 不依赖云厂商 SDK。
2. Elysia Router 不直接操作 R2 或 D1。
3. TanStack Start 不直接读取数据库。
4. Effect Services 使用 Port 访问基础设施。
5. Adapter 必须通过统一契约测试。
6. Cloudflare 专属能力只在 Infrastructure Layer 中出现。

---

## 5. WebDAV 协议

### V1 目标支持

| HTTP Method | 功能 |
|---|---|
| OPTIONS | 协议能力声明 |
| GET / HEAD | 文件读取和元数据 |
| PUT | 文件上传 |
| PROPFIND | 文件和目录属性查询 |
| MKCOL | 创建目录 |
| DELETE | 删除文件和目录 |
| COPY | 复制 |
| MOVE | 移动和重命名 |
| PROPPATCH | 修改自定义属性 |
| LOCK / UNLOCK | 文件锁 |

优先完成基础 WebDAV Class 1 所需行为，再完善锁和 Class 2 兼容性。

Class 2（LOCK / UNLOCK）是 V1 发布门槛：服务器不支持锁时，macOS Finder 只能只读挂载。

不得声明尚未正确实现的协议能力。

### 核心要求

- Unicode 文件名与 URL 编码。
- ETag 和条件请求。
- HTTP Range。
- 目录 Prefix 模拟。
- 自定义属性持久化。
- 多对象操作失败恢复。
- 路径规范化和路径穿越防护。
- 流式上传、下载。
- 并发写入冲突检查。
- SQL-backed 锁及锁续期。

对象存储不具备原子目录移动，因此 COPY/MOVE 需要明确部分失败及恢复策略。

目录 COPY/MOVE 设同步处理上限。超过上限时不做部分执行，直接返回明确错误。上限数值由 Phase 0 实测确定，响应码和 `operation_jobs` 的执行方式在 WebDAV 协议设计中确定。

---

## 6. Authentication & Authorization

### Better Auth

提供：

- 管理员初始化
- 用户登录
- Session
- API Key
- 凭据过期和撤销
- 可选 MFA
- 管理员账户管理

默认关闭公开注册。

### WebDAV

客户端通过 HTTPS + Basic Auth 提供用户名和专用 API Key。

Elysia 负责解析认证信息，Better Auth 验证凭据，Effect 负责判断对应文件、目录和 Mount 是否允许访问。

不允许通过 WebDAV 使用管理员主账户密码作为默认方案。

### 权限模型

V1 支持：

- Admin
- Read Only
- Read / Write
- Mount Scope
- Path Prefix Scope

V1 只有一个管理员账户，配多个客户端凭据和多个 Mount，不做多用户。Read Only、Read / Write、Mount Scope 和 Path Prefix Scope 都绑定在 API Key 凭据上。多用户放到 V2.0。

---

## 7. 数据库与持久化

### Better Auth Tables

由 Better Auth 和 Drizzle Adapter 维护，不自行复制认证数据模型。

### Davloom Tables

| 表 | 用途 |
|---|---|
| storage_backends | 对象存储配置 |
| mounts | Mount 与 Prefix 映射 |
| mount_permissions | API Key 凭据的 Mount 与路径权限 |
| dav_properties | WebDAV 自定义属性 |
| dav_locks | 文件锁 |
| operation_jobs | 复制和移动任务 |
| settings | 实例配置 |
| audit_events | 安全和操作审计 |

默认不建立强制性的完整文件索引。

文件目录通过对象存储 API 获取，需要搜索能力时再引入可重建索引。

### 数据迁移

支持：

- D1 → SQLite
- SQLite → D1
- R2 → S3-compatible Storage
- S3-compatible Storage → R2

迁移需要包含对象、权限、元数据和完整性校验。

敏感凭据不得以明文导出。

---

## 8. Dashboard 功能

### 8.1 Overview

展示：

- 当前存储后端
- Mount 列表
- 对象数量和已知容量
- WebDAV 地址
- 存储连接状态
- 最近操作异常

使用 Astryx Dashboard Layout。

### 8.2 File Explorer

使用 Astryx + TanStack Virtual 构建文件管理器。

功能：

- 文件列表
- 目录导航
- 拖放上传
- 文件下载
- 创建目录
- 重命名
- 移动与复制
- 批量删除
- 排序与搜索
- 文件属性
- 文本预览
- 加载和错误状态

大型文件列表采用分页、虚拟化和按需读取。

### 8.3 Credentials

- 创建 WebDAV API Key
- 命名与管理凭据
- 设置有效期
- 设置只读权限
- 限制 Mount 或路径
- 撤销凭据

### 8.4 Storage & Mounts

- 查看后端存储
- 管理 Bucket 和 Prefix
- 创建 Mount
- 编辑 Mount
- 验证连接
- 查看基本存储信息

### 8.5 Settings

- Profile
- Authentication
- Appearance
- WebDAV Settings
- Storage Configuration
- Data Export
- Instance Information

支持 Light / Dark / System 三种外观模式。

---

## 9. 部署方案

### Cloudflare Free

默认使用：

- TanStack Start Web
- Elysia Worker
- D1
- R2

Dashboard 优先使用 SPA Mode，降低 SSR 运行成本。

Cloudflare Free 的 Worker CPU、请求次数和 R2 上传限制必须通过实际测试。

官方文档已写明的限制（2026 年 11 月核对）：

- **请求体上限 100 MB（Free / Pro 域名）：** 超过时 WebDAV PUT 返回 413。V1 把它写入文档，作为 Cloud Free 的明确限制。Dashboard 大文件上传另行评估分片直传 R2。
- **每个 HTTP 请求 10 ms CPU：** 测试必须覆盖包含认证的完整请求链路。
- **单次调用最多 1000 次内部子请求（R2、D1）：** 决定目录 COPY/MOVE 的同步处理上限。
- **R2 `ListObjects` 属于 Class A，免费额度每月 100 万次：** 目录 PROPFIND 都会消耗这一额度。

### Docker Self-hosted

使用：

- Bun
- TanStack Start
- Elysia
- SQLite
- S3-compatible Storage
- 可选 MinIO

由 Docker Compose 提供标准部署入口。

完全不需要 Cloudflare 账号。

### Hybrid

允许运行环境、数据库和存储后端独立替换。

Cloudflare Service Binding 可作为平台优化，但必须提供标准 HTTP 通信路径。

---

## 10. Monorepo

```text
davloom/
├── apps/
│   ├── web/                # TanStack Start
│   │   └── src/
│   │       ├── routes/
│   │       ├── features/
│   │       │   ├── explorer/
│   │       │   ├── credentials/
│   │       │   ├── mounts/
│   │       │   └── settings/
│   │       ├── components/
│   │       ├── styles/     # StyleX
│   │       └── providers/
│   └── api/                # ElysiaJS
│
├── packages/
│   ├── core/               # Effect
│   ├── schema/             # Effect Schema
│   ├── webdav/             # WebDAV Protocol
│   ├── auth/               # Better Auth
│   ├── client/             # Eden Treaty
│   ├── database/
│   ├── storage/
│   └── ui/                 # Davloom UI
│       ├── components/
│       ├── tokens/
│       ├── themes/
│       └── styles/
│
├── deploy/
│   ├── cloudflare/
│   └── docker/
│
├── tests/
│   ├── unit/
│   ├── contracts/
│   ├── webdav/
│   ├── integration/
│   └── e2e/
│
├── docs/
│   ├── architecture/
│   ├── development/
│   ├── design-system/
│   ├── deployment/
│   └── security/
│
├── openspec/               # OpenSpec specs 与 changes
│   ├── config.yaml
│   ├── specs/
│   └── changes/
│
├── .claude/                # OpenSpec 和 GitNexus 的 Claude Code 命令与 skill
├── .github/
├── AGENTS.md
├── CLAUDE.md
├── prd.md
├── package.json
├── bun.lock
├── tsconfig.json
├── oxlint.json
└── README.md
```

`packages/ui` 只放共享的 Davloom 业务组件、主题和设计令牌，不复制整套 Astryx。

---

## 11. CI/CD

每个 Pull Request 检查：

- Oxlint
- Oxfmt
- TypeScript Typecheck
- Vitest
- Effect Service Tests
- Database Contract Tests
- Storage Contract Tests
- WebDAV Protocol Tests
- Playwright
- Build Verification
- CodeQL / Dependency Review

### UI 专项测试

增加：

- Astryx Component Compatibility
- Light / Dark Mode
- Keyboard Navigation
- Accessibility
- StyleX Production Build
- CSS Layer / Theme Regression
- 大目录列表性能测试

关键界面进行截图回归测试。

### 发布流程

PR → Checks → Build → Preview → Integration Tests → Security Scan → Release → Smoke Test。

支持 SBOM、构建证明和版本回滚。

---

## 12. 安全要求

- Private Bucket 默认开启。
- WebDAV 仅通过 HTTPS 暴露。
- 所有文件访问经过授权。
- 密钥使用平台 Secret 或加密持久化。
- API Key 不以明文长期保存。
- 防止 Path Traversal。
- 限制 XML Body 大小和解析复杂度。
- 防止递归操作耗尽资源。
- 文件读取和写入支持条件请求。
- 不记录敏感认证内容。
- 默认拒绝跨 Mount 的越权操作。

---

## 13. 八周开发计划

| 阶段 | 周期 | 目标 |
|---|---|---|
| Phase 0 | Week 1 | Monorepo、框架、部署和 UI 兼容性验证 |
| Phase 1 | Week 2 | Effect Core、D1/SQLite、R2/S3 |
| Phase 2 | Week 3 | WebDAV 基础协议 |
| Phase 3 | Week 4 | Better Auth、API Key、权限 |
| Phase 4 | Week 5 | Astryx + StyleX Dashboard |
| Phase 5 | Week 6 | WebDAV 兼容性与文件锁 |
| Phase 6 | Week 7 | Docker、Cloudflare、数据迁移 |
| Phase 7 | Week 8 | 测试、安全、文档、发布 |

### Phase 0 必须验证

- Elysia + Effect on Cloudflare Workers。
- Better Auth + D1 / SQLite。
- TanStack Start + React 19。
- Astryx 组件与 TanStack Start 的集成。
- StyleX Vite 编译。
- Astryx Theme 与 Dark Mode。
- Cloudflare Free 的 CPU 和请求开销，覆盖包含认证的完整请求链路。
- WebDAV 方法（OPTIONS、PROPFIND、MKCOL、COPY、MOVE、PROPPATCH、LOCK、UNLOCK）穿过 Elysia、Workers 和 Bun。
- PUT 和 GET 全程流式，不把完整文件缓冲到内存。
- 目录 COPY/MOVE 在 Cloud Free 上的同步处理上限。
- Elysia 起步版本（1.x 稳定版或 2.0）。

### Phase 4 UI 交付

必须完成：

1. Astryx App Shell。
2. File Explorer。
3. Upload / Download UI。
4. Credentials 页面。
5. Storage / Mounts 页面。
6. Settings 页面。
7. Light / Dark Mode。
8. 文件操作状态和错误反馈。

全部采用统一 Design Tokens。

---

## 14. 关键风险

| 风险 | 对策 |
|---|---|
| Astryx Beta API 变动 | 锁定版本、组件兼容测试 |
| StyleX + Vite 集成问题 | Phase 0 验证生产构建 |
| Astryx 组件功能缺口 | 组合现有原语或局部 Swizzle |
| Workers Free CPU 超限 | SPA 优先、减少请求 CPU |
| Elysia Workers 兼容性 | Runtime Integration Tests |
| D1 / SQLite 差异 | Driver Contract Tests |
| R2 / S3 行为差异 | Storage Capability Tests |
| WebDAV 锁与并发 | SQL Lock Tests、保守能力声明 |
| 大型目录操作 | 分页、虚拟化、可恢复任务 |
| 跨平台迁移损失 | 数据校验与恢复测试 |

---

## 15. V1 发布标准

- [ ] Cloudflare 免费套餐可部署。
- [ ] Docker 可独立运行。
- [ ] Astryx Dashboard 完整可用。
- [ ] StyleX 生产构建通过。
- [ ] Light / Dark Mode 正常。
- [ ] Better Auth 登录和 API Key 可用。
- [ ] 文件和目录基础操作可用。
- [ ] WebDAV 基础协议通过测试。
- [ ] WebDAV Class 2（LOCK / UNLOCK）通过测试，macOS Finder 可以读写挂载。
- [ ] R2 与通用 S3 Adapter 可用。
- [ ] D1 与 SQLite Adapter 可用。
- [ ] 权限控制通过测试。
- [ ] 并发和错误恢复行为经过验证。
- [ ] 数据导出和迁移通过测试。
- [ ] Cloudflare / Docker Smoke Tests 通过。
- [ ] 没有已知 Critical 安全漏洞。
- [ ] 发布安装与架构文档。

---

## 16. 后续路线

### V1.1 — Reliability

协议兼容性、性能、异常恢复和文件锁完善。

### V1.2 — Storage Expansion

更多 Storage Provider、本地文件系统、存储迁移增强。

### V2.0 — Advanced Self-hosting

多用户、团队、细粒度权限、PostgreSQL、可选分布式任务。

---

## 17. 最终技术决策

**Davloom 的正式技术栈：**

- TypeScript + Bun
- React 19 + TanStack Start
- TanStack Router / Query / Store / Virtual
- **Meta Astryx + Meta StyleX**
- ElysiaJS
- Effect v4 + Effect Schema
- Better Auth
- Drizzle ORM
- SQLite + Cloudflare D1
- S3-compatible Storage + Cloudflare R2
- Oxlint + Oxfmt
- Vitest + Playwright
- GitHub Actions
- Cloudflare Workers + Docker

**架构：** Hexagonal Architecture + Effect Layers。

**默认部署：** Workers + D1 + R2。

**可移植部署：** Bun + SQLite + S3-compatible Storage。

**设计系统：** Astryx Components + StyleX + Davloom Theme。

**开发流程：** OpenSpec（proposal → specs → design → tasks）。

**产品目标：** 一个免费套餐可用、可自行托管、没有强制云厂商绑定，并具备现代化文件管理体验的开源 WebDAV 平台。
