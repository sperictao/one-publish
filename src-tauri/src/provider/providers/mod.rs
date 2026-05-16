mod cargo;
mod dotnet;
mod go;
mod java_gradle;

use super::registry::BuiltInProvider;

/// 返回所有已注册的内置 Provider。
///
/// 新增 Provider 时只需：1) 添加文件  2) 添加 `mod xxx;`  3) 在此函数中加一行 `xxx::create()`。
/// `registry.rs` 无需修改。
pub(crate) fn all() -> Vec<BuiltInProvider> {
    vec![
        dotnet::create(),
        cargo::create(),
        go::create(),
        java_gradle::create(),
    ]
}
