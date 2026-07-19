# GitHub Actions 固定到完整 commit SHA

托管 workflow 中的官方与第三方 Action 都使用不可变的完整 commit SHA，并在旁边保留可读版本注释；不使用 `@main`、`@stable` 或仅主版本的浮动引用。One Publish 模板升级会展示 Action 版本和 SHA 差异，只有完成显式发布接入后才能更新仓库 workflow。
