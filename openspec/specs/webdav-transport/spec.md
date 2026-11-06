# webdav-transport Specification

## Purpose
定义 WebDAV 请求在 Cloudflare Workers 和 Bun 上如何到达处理入口，以及请求体和响应体如何流式传输。协议语义由后续的协议能力负责。

## Requirements

### Requirement: WebDAV 方法到达处理入口
系统 SHALL 在 Cloudflare Workers 和 Bun 上，把 `/dav/` 下的 OPTIONS、GET、HEAD、PUT、DELETE、PROPFIND、PROPPATCH、MKCOL、COPY、MOVE、LOCK、UNLOCK 请求交给同一个处理入口。

#### Scenario: 全部方法到达
- **WHEN** 测试客户端分别在两种运行时上向 `/dav/a.txt` 发送上述每一种方法
- **THEN** 处理入口收到的方法和路径与客户端发送的一致

#### Scenario: 非 WebDAV 路径不受影响
- **WHEN** 客户端向 `/api/health` 发送 GET 请求
- **THEN** 请求由 API 路由处理，不进入 WebDAV 处理入口

### Requirement: 保留请求路径和请求头
系统 MUST 把原始的百分号编码路径和 WebDAV 请求头原样交给处理入口，MUST NOT 提前解码或丢弃。

#### Scenario: Unicode 和百分号编码路径
- **WHEN** 客户端请求 `/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt`
- **THEN** 处理入口得到的路径仍是 `/dav/%E6%96%87%E4%BB%B6%20a%2Fb.txt`

#### Scenario: WebDAV 请求头
- **WHEN** 请求携带 `Depth`、`Destination`、`If`、`Lock-Token`、`Overwrite` 和 `Timeout`
- **THEN** 处理入口收到的这些请求头的值与客户端发送的一致

### Requirement: 未实现的协议能力不对外声明
协议行为实现之前，生产入口 MUST 对 `/dav/` 下的所有方法返回 501，响应 MUST NOT 包含 `DAV` 响应头。

#### Scenario: OPTIONS 不声明能力
- **WHEN** 客户端向生产入口的 `/dav/` 发送 OPTIONS
- **THEN** 响应状态码是 501，且不含 `DAV` 响应头

#### Scenario: 其他方法
- **WHEN** 客户端向生产入口的 `/dav/a.txt` 发送 PROPFIND 或 PUT
- **THEN** 响应状态码是 501

### Requirement: 请求体流式传输
系统 MUST 在请求体到达时逐段交给处理入口，MUST NOT 等完整请求体到达或把完整请求体缓冲到内存。

#### Scenario: 上传未结束时收到数据
- **WHEN** 客户端分别在两种运行时上发送第一段请求体后暂停
- **THEN** 处理入口在客户端发送剩余数据之前收到第一段

#### Scenario: Bun 上的大文件内存占用
- **WHEN** 客户端向 Bun 上的探测入口上传 1 GiB 请求体，处理入口边读边丢弃
- **THEN** 上传成功，进程常驻内存的峰值增量低于 128 MiB

#### Scenario: Workers 上的文件直通 Durable Object（需要真实部署）
- **WHEN** 客户端向 Workers Free 上的探测入口上传 95 MB 请求体，处理入口把请求流直接交给 Durable Object，由它分块写入 SQLite
- **THEN** 读回内容的大小和校验值与上传内容一致，请求没有因 CPU 超限而失败

### Requirement: 响应体流式传输
系统 MUST 在响应体生成时逐段发送，MUST NOT 等完整响应生成后才开始发送。

#### Scenario: 下载未结束时收到数据
- **WHEN** 处理入口写入第一段响应后暂停
- **THEN** 客户端在处理入口写入第二段之前收到第一段
