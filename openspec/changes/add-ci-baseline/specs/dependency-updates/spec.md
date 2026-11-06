# Spec Delta

## Purpose

让依赖持续保持在 npm `latest` 标签上的精确版本，新版本一发布就进入更新流程，同时让间接依赖和已知漏洞也有固定的处理方式。

## ADDED Requirements

### Requirement: 自动提出依赖更新
依赖的 npm `latest` 标签指向新版本后，项目 SHALL 在下一次自动运行时创建更新它的 Pull Request，不设发布后的等待期。更新后的声明 MUST 仍是精确版本，预发布标签 MUST NOT 算作新版本。

#### Scenario: 刚发布的 latest 版本（需要真实仓库，人工验证）
- **WHEN** 某个依赖刚发布新版本，npm `latest` 标签已经指向它
- **THEN** 下一次自动运行后出现一个更新它的 Pull Request，声明是精确版本，统一检查命令通过

### Requirement: 直接依赖的安全修复
直接依赖有已公开漏洞并且已有修复版本时，项目 SHALL 创建一个升级到修复版本的 Pull Request。

#### Scenario: 有漏洞修复版本（需要真实仓库，人工验证）
- **WHEN** 一个直接依赖有已公开漏洞，修复版本已经发布
- **THEN** 出现一个升级到修复版本的 Pull Request，并标明它修复的漏洞

### Requirement: 设计系统依赖保持一致
Astryx 的各个包 MUST 在同一个 Pull Request 里升级到相同版本。已安装的 StyleX 版本 MUST 满足 Astryx 声明的 peer 依赖范围，不满足时统一检查命令 MUST 失败。

#### Scenario: Astryx 发布新版本（需要真实仓库，人工验证）
- **WHEN** Astryx 发布新版本
- **THEN** 只有一个更新 Astryx 的 Pull Request，其中所有 Astryx 包都是同一版本

#### Scenario: StyleX 不在 Astryx 的要求范围内
- **WHEN** 已安装的 StyleX 版本不在 Astryx 声明的 peer 依赖范围内
- **THEN** 统一检查命令失败，错误信息给出 Astryx 要求的范围和已安装的版本

#### Scenario: StyleX 发布超出范围的新版本（需要真实仓库，人工验证）
- **WHEN** StyleX 发布的新版本不在 Astryx 的 peer 依赖范围内
- **THEN** 不出现升级 StyleX 的 Pull Request

### Requirement: 间接依赖定期刷新
项目 SHALL 定期刷新锁文件，让间接依赖也能拿到修复。

#### Scenario: 定期刷新（需要真实仓库，人工验证）
- **WHEN** 到了刷新周期，并且锁文件里的间接依赖有新版本
- **THEN** 出现一个只改锁文件的 Pull Request

### Requirement: 已有依赖的新漏洞
项目 SHALL 定期扫描 `main` 上的锁文件，这样在没有 Pull Request 时也能发现新公开的漏洞。

#### Scenario: 新漏洞公开（需要真实仓库，人工验证）
- **WHEN** `main` 已有的依赖新公开了漏洞
- **THEN** 下一次定时扫描失败，并指出依赖名称和漏洞编号
