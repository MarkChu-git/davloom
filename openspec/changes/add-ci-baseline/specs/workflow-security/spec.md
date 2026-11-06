# Spec Delta

## Purpose

防止 CI 本身成为供应链攻击的入口：第三方 Action、过宽的令牌权限和不可信的 Pull Request 都不能拿到仓库的写权限或密钥。

## ADDED Requirements

### Requirement: 第三方 Action 固定到提交
每个 workflow 引用的 Action MUST 固定到完整的 commit SHA，MUST NOT 使用可变的 tag 或分支。

#### Scenario: 使用可变 tag
- **WHEN** Pull Request 在 workflow 里用 tag 引用一个 Action
- **THEN** 工作流检查失败，并指出这一行

### Requirement: 令牌权限最小
每个 workflow MUST 显式声明 `permissions`，默认只读。需要更多权限的 job MUST 单独声明，并且只声明它用到的权限。

#### Scenario: 没有声明权限
- **WHEN** Pull Request 新增一个没有声明 `permissions` 的 workflow
- **THEN** 工作流检查失败

### Requirement: 不使用特权触发器
workflow MUST NOT 使用 `pull_request_target` 触发器。

#### Scenario: 使用特权触发器
- **WHEN** Pull Request 新增一个由 `pull_request_target` 触发的 workflow
- **THEN** 工作流检查失败

### Requirement: Pull Request 检查不接触密钥
Pull Request 的检查 MUST NOT 读取云凭据和仓库 secrets，来自 fork 的 Pull Request MUST 能得到和仓库内分支相同的检查结果。

#### Scenario: 来自 fork 的 Pull Request（需要真实仓库，人工验证）
- **WHEN** 外部贡献者从 fork 发起 Pull Request
- **THEN** 必过检查全部运行，结果不受缺少 secrets 的影响

### Requirement: 工作流文件接受检查
每个修改 workflow 文件的 Pull Request MUST 通过语法检查和安全检查。

#### Scenario: 工作流语法错误
- **WHEN** Pull Request 含有语法错误的 workflow 文件
- **THEN** 工作流检查失败，并指出错误位置
