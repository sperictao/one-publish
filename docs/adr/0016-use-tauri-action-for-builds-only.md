# tauri-action 只负责平台构建

托管 workflow 在各平台矩阵 job 中使用官方 `tauri-action` 构建 Tauri bundle 并上传 workflow artifacts，但不向它提供 `tagName`、`releaseName` 或 `releaseId`，避免多个矩阵 job 并发修改同一个 Release。全部启用平台成功后，唯一的 One Publish release 组装任务下载产物、应用 Release 附件白名单、验证 Updater 要求，以自动化 Draft 暂存并幂等上传全部附件，最后才切换为 Published；失败重跑复用同一 Draft，不会暴露部分 Published Release。

GitHub 发布不要求预先完成本地构建，远端矩阵构建才是其权威结果；本地构建保持独立，仅当仓库把 Tauri build 明确加入本地发布门禁时才成为前置条件。
