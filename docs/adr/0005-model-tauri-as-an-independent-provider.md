# 将 Tauri 建模为独立 Provider

Tauri 使用独立 Project Provider，而不是在 Cargo Provider 中增加特殊分支。现有 Cargo Provider 的职责是运行 `cargo build` 并定位普通 Rust 产物，Tauri 则需要识别前端包管理器、调用 Tauri CLI、定位平台 bundle，并贡献完整桌面应用的构建计划片段。仓库同时满足 Tauri 与 Cargo 标记时，项目发现必须返回两个独立 Project Candidate 并保留检测依据，由发布配置明确绑定其中一个；检测顺序不得覆盖候选或静默改变既有绑定。
