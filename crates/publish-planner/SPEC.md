---
id: module-publish-planner
type: module-design
status: active
title: publish-planner
parent: architecture
depends-on: [module-publish-domain, module-publish-adapters]
---

## Responsibility

能力协商与计划生成：把一份 Planning Input Snapshot 与已选 Adapter 匹配成一个确定性 Publish Plan，
并按固定阶段（检查源码 → 发布身份 → 构建 → 收集 → 处理验证 → 封存清单 → 暂存 → 提交 → 观察）
组合各自声明的计划片段。相同快照必须产生相同计划与相同摘要。

不兼容时返回具体缺失能力，绝不静默换 Provider、跳过 Processor、减少平台或改用另一目标。已知的外部
检查带时间与有效期，执行前只重新验证，不重新规划。

## Boundary

依赖 `publish-domain` 与 `publish-adapters` 的注册表；只做匹配与组合。不执行计划、不起进程、不碰
文件系统与网络、不落盘。执行、事件、重试、租约属于 `publish-runner-core`。
