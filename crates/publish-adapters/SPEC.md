---
id: module-publish-adapters
type: module-design
status: active
title: publish-adapters
parent: architecture
depends-on: [module-publish-domain]
---

## Responsibility

内置 Adapter 的唯一登记处与实现集合：Tauri Project Provider、Local 与 GitHub Actions 两个 Execution
Backend、Local Directory / GitHub Release / SFTP 三个 Delivery Destination、临时 Artifact Store、
校验和与结构化自定义命令 Processor，以及把桌面 Provider 的原生执行桥接进计划节点的 bridge。
每个 Adapter 声明自己的能力与约束，供能力协商使用。

## Boundary

只依赖 `publish-domain`；不依赖 planner 或 runner-core——登记表由它们反过来消费。Adapter 之间不得
互相识别：不按类型名或目标名称分支，匹配只经能力声明。某一目标的特例（协议语义、幂等探测方式）
留在该 Adapter 内部，不上升为共享配置，也不渗进别的 Adapter。

需要启动进程时只使用结构化 `program + args`；任何形态的 shell 字符串都不属于本模块的合同。
凭据以引用进入，实际值只经 Execution Backend 的凭据源解析。
