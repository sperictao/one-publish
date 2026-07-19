# GitHub Release 只上传白名单附件

发布接入会识别 Tauri bundle 并让使用者确认 Release 附件类型，托管 workflow 只把白名单内的最终产物上传到 GitHub Release。Updater 暂存产物、签名辅助文件、调试文件和其他 CI 中间内容不会因为被构建出来就自动上传；本项目默认包含 DMG、macOS Updater 压缩包、NSIS setup、AppImage、DEB 和 `latest.json`，其他格式必须明确选择。
