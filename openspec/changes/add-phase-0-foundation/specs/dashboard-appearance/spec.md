# Spec Delta

## Purpose

定义 Dashboard 的主题和外观模式行为，保证设计系统组件与 Davloom 自有组件在生产构建中外观一致。

## ADDED Requirements

### Requirement: 外观模式
Dashboard SHALL 支持 Light、Dark 和 System 三种外观模式，默认使用 System。用户的选择 MUST 在刷新后保留。

#### Scenario: 切换模式
- **WHEN** 用户把外观切换为 Dark
- **THEN** 页面立即使用深色主题

#### Scenario: 刷新后保留
- **WHEN** 用户选择 Dark 后刷新页面
- **THEN** 页面仍是 Dark，首次绘制时已经是深色

#### Scenario: 跟随系统
- **WHEN** 外观模式是 System，操作系统配色从浅色变为深色
- **THEN** 页面不刷新就切换为深色主题

### Requirement: 设计系统组件与自有样式共存
生产构建中，设计系统组件和 Davloom 自有组件的样式 MUST 同时生效，任何一方 MUST NOT 覆盖另一方。

#### Scenario: 示例页的计算样式
- **WHEN** Playwright 打开生产构建的示例页
- **THEN** 设计系统组件的计算样式来自主题令牌，自有组件的计算样式来自自有样式，两者都不是浏览器默认样式

#### Scenario: 外观切换时同步变化
- **WHEN** 外观从 Light 切换为 Dark
- **THEN** 设计系统组件和自有组件都改用深色令牌的值

### Requirement: 主题通过令牌定义
Davloom Theme MUST 通过设计系统的主题机制和可导出的设计令牌定义，MUST NOT 修改依赖源码。

#### Scenario: 修改品牌色令牌
- **WHEN** 修改 Davloom Theme 的品牌色令牌并重新构建
- **THEN** 设计系统组件和自有组件的品牌色都随之变化，依赖目录没有任何改动
