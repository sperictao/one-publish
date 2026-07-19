# 发布提交只包含白名单文件

One Publish 只暂存权威版本来源、发布接入确认的版本镜像和本次 `release-notes/vX.Y.Z.md`，绝不运行 `git add -A`。发布门禁如果产生任何白名单外变化，发布必须停止并展示 diff，由使用者决定如何处理；One Publish 不自动提交、还原或删除这些额外文件。
