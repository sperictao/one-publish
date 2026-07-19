# 发布说明随发布提交入库并作为单一来源

One Publish 根据上一稳定版本标签到当前 HEAD 的提交生成可编辑草稿，并在发布时保存为 `release-notes/vX.Y.Z.md`，与版本字段一起进入发布提交。托管 workflow 使用同一文件生成 GitHub Release 正文和 Updater 更新说明，不让 GitHub 自动生成内容形成第二份发布说明。
