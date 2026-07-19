# 私有仓库支持普通 Release 但不支持 Updater

One Publish 首版同时支持公开与私有 `github.com` 仓库，GitHub Release 的可见范围继承仓库权限。私有仓库不能启用 Tauri Updater，因为首版没有安全的客户端认证下载模型；One Publish 不会通过应用配置、Updater 请求或生成产物把 GitHub Token 下发给客户端。
