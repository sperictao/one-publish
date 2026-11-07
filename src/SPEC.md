---
id: module-renderer
type: module-design
status: active
title: 渲染层（src）
parent: architecture
---

## Responsibility

桌面界面：配置模块（列表、分组、搜索、收藏、最近使用、修订、健康状态）、发布执行面（计划预览、执行、
取消、续传、Attempt 与交付凭证展示）、仓库与项目候选选择、执行历史、环境修复引导，以及键盘优先的
快捷操作。状态按 slice 组织，偏好与本地视图状态留在前端。

## Boundary

不做发布语义判断：不解释计划、不归约 Publish Event、不推断交付状态——展示的都是后端给出的事实。
一切系统能力经 commands 与 events 获得，类型来自生成的契约，不手写一份并行定义。

前端不持有权威配置：配置编辑保存为新的不可变修订，经后端校验后生效。不希望用户看见的东西
（秘密值）从来不会到达这一层，因此这里也不做脱敏补救。
