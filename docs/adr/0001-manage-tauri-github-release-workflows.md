# 由 One Publish 托管 Tauri GitHub 发布流程

One Publish 将为目标 Tauri 仓库生成并持续维护 GitHub 发布流程，而不是仅编排仓库已有流程。这样可以提供一致的一键发布体验，并集中维护跨平台构建、签名、Updater 产物和 GitHub Release 约定；代价是 One Publish 必须明确处理流程版本、仓库定制与托管内容漂移。

托管流程使用独立的 `.github/workflows/one-publish-tauri-release.yml`，仓库差异通过 One Publish 配置表达，不直接编辑生成文件。检测到托管流程漂移时，One Publish 必须展示差异并要求使用者明确覆盖，不自动合并，也不静默发布。

发布接入与发布执行是两个独立阶段。首次生成和后续升级只发生在发布接入阶段；发布执行发现托管流程缺失或漂移时必须停止，并引导使用者先完成发布接入，不能在发版过程中顺带修改流程。
