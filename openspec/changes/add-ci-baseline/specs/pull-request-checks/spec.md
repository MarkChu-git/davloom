# Spec Delta

## Purpose

规定每个 Pull Request 合并前必须通过哪些检查，让 `main` 始终能构建、能通过测试，并且 CI 和本地使用同一批命令。

## ADDED Requirements

### Requirement: 质量检查必过
每个目标分支是 `main` 的 Pull Request MUST 通过统一检查命令覆盖的全部检查项。任何一项失败时，该 Pull Request MUST NOT 合并。

#### Scenario: 检查失败（需要真实仓库，人工验证）
- **WHEN** Pull Request 含有一个类型错误
- **THEN** CI 失败，日志指出失败的检查项，这个 Pull Request 不能合并

#### Scenario: 检查通过（需要真实仓库，人工验证）
- **WHEN** Pull Request 的全部必过检查都通过
- **THEN** 这个 Pull Request 可以合并

### Requirement: 依赖安装可复现
CI MUST 严格按锁文件安装依赖，锁文件和依赖声明不一致时 MUST 失败。

#### Scenario: 锁文件过期（需要真实仓库，人工验证）
- **WHEN** Pull Request 修改了依赖声明，但没有更新锁文件
- **THEN** 安装步骤失败，后续检查不运行

### Requirement: 兼容性测试必过
每个 Pull Request MUST 在 Workers 运行时和 Bun 上运行兼容性测试，并在生产构建上运行浏览器测试。这些测试 MUST NOT 依赖云账号。

#### Scenario: 没有云凭据（需要真实仓库，人工验证）
- **WHEN** CI 在没有 Cloudflare 凭据的环境运行兼容性测试命令
- **THEN** 本地用例全部运行，需要真实部署的用例显示为跳过，命令以状态 0 退出

#### Scenario: 运行时不兼容（需要真实仓库，人工验证）
- **WHEN** Pull Request 让某个路由在 Bun 上的行为和 Workers 不一致，并且有兼容性测试覆盖这个行为
- **THEN** CI 失败，这个 Pull Request 不能合并

### Requirement: 类型感知的 lint
CI 的 lint MUST 包含依赖类型信息的规则，并用每个文件所属运行时的类型环境检查它。

#### Scenario: 未处理的 Promise
- **WHEN** Bun 代码里有一个既没有等待也没有处理的 Promise
- **THEN** lint 失败，并指出这一行

#### Scenario: 只在 Workers 下编译的文件
- **WHEN** 一个只属于 Workers 类型环境的文件里有未处理的 Promise
- **THEN** lint 失败并指出这一行，没有因为找不到类型信息而产生的其他报错

### Requirement: 依赖漏洞扫描
每个 Pull Request MUST 扫描锁文件解析出的全部依赖，包括间接依赖。发现已知漏洞时扫描 MUST 失败，并指出依赖名称和漏洞编号；登记了原因且未到期的例外除外。

#### Scenario: 引入有已知漏洞的依赖（需要真实仓库，人工验证）
- **WHEN** Pull Request 把一个依赖改成有已公开漏洞的版本
- **THEN** 扫描失败，日志里有依赖名称和漏洞编号

#### Scenario: 登记了例外的漏洞
- **WHEN** 锁文件里的漏洞在扫描配置里登记了原因和到期日，并且还没到期
- **THEN** 扫描通过

#### Scenario: 例外到期
- **WHEN** 登记的到期日已经过去
- **THEN** 扫描重新失败

### Requirement: 密钥泄露扫描
每个 Pull Request MUST 扫描它新增的提交，发现疑似凭据时 MUST 失败。明确标记为测试固定值的内容 MUST NOT 触发失败。

#### Scenario: 提交里有凭据（需要真实仓库，人工验证）
- **WHEN** Pull Request 的某个提交含有形如云服务密钥的字符串
- **THEN** 扫描失败，日志指出提交和文件，并且不打印完整的密钥

#### Scenario: 测试固定值
- **WHEN** 仓库里只有已列入允许清单的测试固定值
- **THEN** 扫描通过

### Requirement: 静态安全分析
每个 Pull Request MUST 对 TypeScript 代码运行静态安全分析。分析发现的高危问题 MUST 阻止合并。

#### Scenario: 引入高危问题（需要真实仓库，人工验证）
- **WHEN** Pull Request 引入分析工具判定为高危的代码
- **THEN** 这个 Pull Request 不能合并

### Requirement: 覆盖率只报告不阻塞
CI SHALL 报告测试覆盖率。覆盖率的高低和变化 MUST NOT 阻止合并。

#### Scenario: 覆盖率下降（需要真实仓库，人工验证）
- **WHEN** Pull Request 让覆盖率下降
- **THEN** CI 报告新的覆盖率，这个 Pull Request 仍然可以合并

### Requirement: 本地可以复现
CI 的质量检查和兼容性测试 MUST 调用贡献者在本地运行的同一批命令。

#### Scenario: 本地复现失败（需要真实仓库，人工验证）
- **WHEN** 贡献者在本地运行 CI 日志里失败的那条命令
- **THEN** 同样的检查项失败
