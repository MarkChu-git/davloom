# Spec Delta

## Purpose

用可重复运行的测试验证选型组合在 Workers 和 Bun 上可用，并记录 Cloud Free 限制的实测结果，为版本升级和后续设计提供依据。

## ADDED Requirements

### Requirement: 不依赖云账号的本地兼容性测试
项目 SHALL 提供一条命令，在没有 Cloudflare 凭据的环境中，于 Workers 运行时和 Bun 上运行兼容性测试。需要真实部署的用例 MUST 标记为跳过，不算失败。

#### Scenario: 没有云凭据
- **WHEN** 贡献者在没有 Cloudflare 凭据的环境运行兼容性测试命令
- **THEN** 本地用例在两种运行时上运行，需要真实部署的用例显示为跳过，命令以状态 0 退出

### Requirement: 业务错误映射为确定的 HTTP 响应
API 入口 MUST 把业务编排层的成功结果和已声明错误映射为确定的 HTTP 响应。未预期的缺陷 MUST 返回 500，响应 MUST NOT 包含内部错误细节。

#### Scenario: 业务成功
- **WHEN** 业务程序在任一运行时上成功完成
- **THEN** 响应包含程序的结果和对应的成功状态码

#### Scenario: 已声明错误
- **WHEN** 业务程序以已声明的错误失败
- **THEN** 响应使用该错误对应的状态码和错误码

#### Scenario: 未预期缺陷
- **WHEN** 业务程序抛出未声明的缺陷
- **THEN** 响应状态码是 500，响应体不含错误消息和堆栈

### Requirement: 身份组件在两种数据库上行为一致
同一份身份配置和数据库 schema MUST 在 D1 和 Bun SQLite 上支持管理员登录，以及 API Key 的创建、验证和撤销。

#### Scenario: 管理员登录
- **WHEN** 管理员分别在两种数据库上用正确密码和错误密码登录
- **THEN** 正确密码建立 Session，错误密码被拒绝且不建立 Session

#### Scenario: API Key 生命周期
- **WHEN** 分别在两种数据库上创建 API Key，用它验证，撤销后再次验证
- **THEN** 撤销前验证通过，撤销后验证失败，数据库中不保存 Key 明文

### Requirement: 设计系统与前端框架集成
Dashboard 的生产构建 MUST 在 SPA 模式下渲染设计系统的交互组件，运行时 MUST NOT 产生控制台错误。生产构建 SHALL 能由 Workers 静态资源和 Bun 提供。

#### Scenario: 交互组件
- **WHEN** Playwright 打开生产构建的示例页，用键盘操作 Dialog 和 Menu
- **THEN** 组件正常打开和关闭，焦点回到触发元素，控制台没有错误

#### Scenario: 深层路由
- **WHEN** 分别由本地 Workers 运行时和 Bun 提供生产构建，直接打开一个深层路由
- **THEN** 页面正常渲染该路由

### Requirement: Cloud Free 限制实测
项目 SHALL 在真实的 Workers Free 部署上测量含认证请求的资源消耗和平台限制，并把数据记入结论文档。

#### Scenario: 含认证请求的 CPU（需要真实部署）
- **WHEN** 分别连续发送 100 次携带 API Key 的探测请求和 20 次管理员密码登录请求
- **THEN** 结论文档记录两类请求的 CPU 时间分布和超限次数

#### Scenario: 启动开销（需要真实部署）
- **WHEN** 部署探测 Worker
- **THEN** 结论文档记录压缩后体积和启动时间

#### Scenario: 请求体上限（需要真实部署）
- **WHEN** 分别上传 95 MB 和 105 MB 请求体
- **THEN** 95 MB 写入成功，105 MB 返回 413

#### Scenario: 目录操作上限（需要真实部署）
- **WHEN** 探测入口在一次已认证的请求内，把 Durable Object 中的对象逐个复制并删除，直到触发平台限制或达到设定的测量上限
- **THEN** 结论文档记录单次请求完成的最大对象数、CPU 时间和写入行数，并给出目录 COPY/MOVE 的同步处理上限

#### Scenario: 配额消耗（需要真实部署）
- **WHEN** 发送一次携带 API Key 的目录 PROPFIND 探测请求
- **THEN** 结论文档记录这次请求产生的 D1 读写行数和 Durable Object 读写行数

#### Scenario: Durable Object 的 CPU 上限（需要真实部署）
- **WHEN** 在 Workers Free 上的 Durable Object 内逐级增加单次请求的 CPU 负载，直到请求失败或超过文档写明的 30 秒
- **THEN** 结论文档记录成功完成的最大 CPU 时间和超限时的表现，并判断 30 秒上限在 Free 上是否成立

### Requirement: 探测入口隔离
兼容性测试使用的探测路由 MUST NOT 进入生产入口。云端的探测 Worker 和测试数据 MUST 在实测结束后删除。

#### Scenario: 生产入口没有探测路由
- **WHEN** 客户端向生产入口请求探测路由
- **THEN** 响应状态码是 404

#### Scenario: 实测后清理（需要真实部署，人工验证）
- **WHEN** 实测结束
- **THEN** Cloudflare 账号中不再有探测 Worker、它的 Durable Object 命名空间和 D1 测试数据库

### Requirement: 验证结论可追溯
每轮兼容性验证 MUST 产出结论文档，逐项记录验证清单的结果、数据、依赖版本和后续动作。验证未通过时 MUST 记录数据和可选方案，MUST NOT 通过降低安全参数等方式静默绕过。

#### Scenario: 清单全覆盖（人工验证）
- **WHEN** 查看 Phase 0 结论文档
- **THEN** PRD Phase 0 验证清单的每一项都有结果、证据和依赖版本

#### Scenario: 验证未通过（人工验证）
- **WHEN** 某一项验证未通过，例如管理员密码登录超过 CPU 限制
- **THEN** 文档写明数据和可选方案，选型和安全参数在用户决定之前保持不变
