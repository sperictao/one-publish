---
id: module-one-publish-runner
type: module-design
status: active
title: one-publish-runner
parent: architecture
depends-on: [module-publish-domain, module-publish-adapters, module-publish-runner-core]
---

## Responsibility

独立命令行 Runner：`verify`（校验已安装投影与其摘要）、`prepare-from-projection`（从投影的触发输入
与分片重建计划）、`execute`（执行并输出标准事件、产物清单与交付凭证），并负责跨 job 分片产物的
暂存与装载。它是远端自动化唯一真正运行发布的东西。

退出码是证据的一部分：被信号取消的运行按 shell 惯例以 128+信号值退出，让调用方的 `set -e` / `&&`
链停下，而不是继续后续步骤。

## Boundary

依赖 `publish-domain`、`publish-adapters`、`publish-runner-core`。只消费已封存投影：不读取桌面状态、
不重新选择 Adapter、不修改投影内容，也不反向写回控制面。控制面只负责生成投影；投影与 Runner 之间
唯一的耦合是固定的运行时修订（Runner 版本与摘要、计划合同版本、Adapter 版本、投影摘要）。
