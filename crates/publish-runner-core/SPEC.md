---
id: module-publish-runner-core
type: module-design
status: active
title: publish-runner-core
parent: architecture
depends-on:
  [module-publish-domain, module-publish-adapters, module-publish-planner]
---

## Responsibility

Publish Plan 的执行语义，本机与远端共用同一份：节点调度、可追加可去重的 Publish Event 流与确定性
reducer、资源租约、外部副作用的幂等探测、失败分类驱动的自动重试、取消边界，以及 Release Attempt
状态与交付路线结果的聚合（完整成功 / 带警告成功 / 部分交付 / 失败 / 取消）。

## Boundary

依赖 `publish-domain`、`publish-adapters`、`publish-planner`。不写 Adapter 特例：目标与后端的差异
只能经 Adapter 声明的能力与失败分类表达。不自行选择 Provider、Store、Processor 或 Destination——
选择属于配置修订，匹配属于 planner。

不拥有持久化：Attempt、事件、清单与凭证由调用方保存（桌面壳或 runner CLI）。不读桌面状态，
不因此获得对控制面的依赖。
