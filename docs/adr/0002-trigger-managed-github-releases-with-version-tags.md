# 使用版本标签触发托管 GitHub 发布

One Publish 在本地确认默认分支干净且已同步后，统一更新版本与 release notes，运行发布校验，创建发布提交，并依次推送默认分支和 `vX.Y.Z` 标签。托管 GitHub workflow 只响应版本标签并负责多平台构建、签名、Updater 产物和 GitHub Release；不使用让 CI 反向修改默认分支的 `workflow_dispatch` 发版模式，从而保证版本文件、发布提交、标签与产物指向同一源码状态。

GitHub Release 只能在所有启用平台的构建、签名策略和 Updater 产物验证成功后创建，并在成功时自动进入 Published 状态；首版不创建等待人工审批的 Draft，任何前置 job 失败都不得留下部分版本。
