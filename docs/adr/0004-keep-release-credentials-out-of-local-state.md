# 发布凭据不进入 One Publish 本地状态

One Publish 不持久化 GitHub Token、签名私钥或密码，本地状态、配置备份、执行历史和日志只能保存凭据引用或脱敏后的检查结果。Git push 使用系统 Git credential，GitHub API 使用现有 `gh auth` 或系统凭据，远端签名材料保存在 GitHub Actions Secrets，本地签名材料在执行时从系统钥匙串或环境读取；这减少了 One Publish 成为秘密保管库所带来的泄露面和迁移责任。

发布接入检测到缺失的 Actions Secret 时，只显示 Secret 名称、用途和外部配置方式；使用者通过 GitHub Settings 或 `gh secret set` 配置后重新检查。One Publish 不提供秘密值输入或上传能力。
