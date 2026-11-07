---
id: module-desktop-shell
type: module-design
status: active
title: 桌面控制面外壳（src-tauri）
parent: architecture
depends-on: [module-publish-domain, module-publish-adapters, module-publish-runner-core, module-one-publish-runner]
---

## Responsibility

控制面外壳：Tauri 命令面（仓库与项目候选扫描、配置修订与状态、发布运行时、自动化绑定、导出、更新器、
托盘），本地状态持久化与迁移，Attempt 日志与远端证据同步，源码身份解析，Provider 注册表与参数 Schema，
环境探测与修复建议，以及产物打包与签名等操作系统级能力。

## Boundary

依赖四个 crate，把它们当作执行语义的唯一定义处——不在外壳里复制计划解释、事件归约或 Adapter 逻辑。
前端只经 commands（请求/响应）与 events（异步信号）通信，两端类型由 `ts-rs` 生成并用
`pnpm check:contracts` 在 CI 里校验；手改生成的契约即为破坏边界。

秘密只出现在解析边界：配置、导出、备份、计划、清单、日志与事件只有引用，没有值。同时它不拥有远端
仓库里的任何权威配置——远端只保存只读投影，且不得从投影反向恢复配置。
