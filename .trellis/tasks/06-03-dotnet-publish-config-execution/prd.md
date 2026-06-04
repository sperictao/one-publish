# dotnet publish config execution

## Goal

保持 OnePublish 的发布配置为结构化配置，并确保真正执行发布时统一由后端从 `PublishSpec` 渲染和执行 `dotnet publish`。项目 `.pubxml` 配置通过 MSBuild `PublishProfile` 交给 dotnet/MSBuild 处理，命令字符串只用于展示、日志和排障。

## Requirements

- 自定义 dotnet 发布配置必须继续映射到 `PublishSpec.parameters`，而不是保存成一整串命令。
- `.pubxml` 项目发布配置必须写入 `properties.PublishProfile`，由后端渲染为 `-p:PublishProfile=<name>`。
- 命令预览、发布执行、历史重跑必须复用同一份 `PublishSpec` 和后端渲染入口。
- `delete_existing_files` 必须保持为 OnePublish 应用级发布前清理策略，不作为普通 MSBuild property 注入。
- 发布执行前继续由后端统一做输出目录预检、权限检查和清理策略。
- OnePublish 不再提供 `dotnet publish` 不支持的固定字段，也不保留旧 `define` 兼容字段；条件编译常量如需支持，使用 `properties.DefineConstants` 通过 `-p:` 交给 MSBuild。
- Visual Studio 专属或部署自动化 `.pubxml` 字段不得作为 OnePublish 可编辑发布字段进入执行参数，例如 `PublishProvider`、`WebPublishMethod`、`LaunchSiteAfterPublish`、`LastUsedBuildConfiguration`、`ProjectGuid`、`_TargetId`、`PublishUrl`。

## Acceptance Criteria

- [x] 自定义配置 `Release + win-x64 + ./publish` 的预览命令包含对应 dotnet 参数。
- [x] 点击发布时调用 `execute_provider_publish`，不直接执行前端拼出来的命令字符串。
- [x] 选择项目 `.pubxml` profile 后，最终 `PublishSpec.parameters.properties.PublishProfile` 等于 profile 名称。
- [x] `.pubxml` profile 的预览命令包含 `-p:PublishProfile=<profileName>`。
- [x] `delete_existing_files = true` 时，后端执行前仍走清理策略。
- [x] 历史重跑能恢复并执行同一份 `PublishSpec`。
- [x] 命令导入、发布预览、发布执行不产生第二套配置来源。
- [x] 自定义配置、命令导入和 `.pubxml` 复制不会再生成 `define` 或 Visual Studio 专属发布字段。

## Notes

- MVP 只支持 `dotnet publish` 能可靠执行的本地目录或已挂载目录发布。
- MSDeploy、Azure/Kudu、Visual Studio 专属部署字段先不做真正执行支持。
- `.pubxml` 由 dotnet/MSBuild 读取，OnePublish 不完整解释 `.pubxml` 内部所有字段。
