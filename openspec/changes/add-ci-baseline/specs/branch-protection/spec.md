# Spec Delta

## Purpose

保护 `main` 分支，让所有改动都经过 Pull Request 和必过检查，同时不让单人维护的项目被审批规则卡住。

## ADDED Requirements

### Requirement: main 只接受通过检查的 Pull Request
`main` MUST 拒绝直接推送、强制推送和删除。Pull Request MUST 通过全部必过检查后才能合并。

#### Scenario: 直接推送（需要真实仓库，人工验证）
- **WHEN** 有人直接向 `main` 推送提交
- **THEN** 推送被拒绝

#### Scenario: 强制推送（需要真实仓库，人工验证）
- **WHEN** 有人强制推送 `main`
- **THEN** 推送被拒绝

### Requirement: 单人维护时不强制审批
只有一个维护者时，`main` MUST NOT 要求其他人的审批。项目 SHALL 标明各目录的责任人。

#### Scenario: 维护者合并自己的 Pull Request（需要真实仓库，人工验证）
- **WHEN** 唯一的维护者提交 Pull Request，必过检查全部通过
- **THEN** 不需要其他人审批就可以合并
