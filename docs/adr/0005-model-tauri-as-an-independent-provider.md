# 将 Tauri 建模为独立 Provider

Tauri 使用独立 Provider，而不是在 Cargo Provider 中增加特殊分支。现有 Cargo Provider 的职责是运行 `cargo build` 并定位普通 Rust 产物，Tauri 则需要识别前端包管理器、调用 Tauri CLI、定位平台 bundle，并支持本地构建和 GitHub 发布目标；仓库同时满足 Tauri 与 Cargo 标记时必须优先识别为 Tauri，避免只构建 `src-tauri` Rust 二进制而遗漏完整桌面应用。
