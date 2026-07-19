# 遵循 Tauri 语义确定权威版本来源

One Publish 按 Tauri 自身规则解析发布版本：`tauri.conf.*` 明确声明版本时使用该值或它引用的文件，否则使用 `src-tauri/Cargo.toml` 的 package version。接入时可以把 `package.json`、`Cargo.toml`、`Cargo.lock` 等字段登记为版本镜像，发布事务会一起更新；任何镜像在发布前与权威版本不一致时都必须报错，不能猜测或形成第二版本来源。
