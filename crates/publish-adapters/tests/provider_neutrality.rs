use std::path::{Path, PathBuf};

/// 发布核心与共享 Adapter 实现必须保持 Provider 中立（Issue T18、ADR-0024）：
/// Publish Core、Processor、Backend、Store 与 Destination 不得引用任何具体
/// Project Provider 的身份。受检面按目录遍历收集，新增源文件自动纳入。
///
/// 不在受检面内的只有三类：Provider 自身的实现模块（tauri.rs、fixture.rs，
/// 它们定义身份）、组装根（src-tauri 与 one-publish-runner 的 Adapter Catalog
/// 按快照身份注册实现，ADR-0025），以及 publish-adapters/src/lib.rs 的模块
/// 声明与 re-export 行——该文件承载注册表与 conformance 核心，因此其余行
/// 仍以剥离模块接线后的形态受检。
const PROVIDER_NEUTRAL_SOURCE_DIRS: &[&str] = &[
    "crates/publish-domain/src",
    "crates/publish-planner/src",
    "crates/publish-runner-core/src",
    "crates/publish-adapters/src",
];

const PROVIDER_IMPLEMENTATION_FILES: &[&str] = &[
    "crates/publish-adapters/src/tauri.rs",
    "crates/publish-adapters/src/fixture.rs",
];

const MODULE_WIRING_FILE: &str = "crates/publish-adapters/src/lib.rs";

/// Provider 身份的可检形态：id 字符串字面量、id 常量、类型名与模块路径。
/// 注释或错误消息里的自然语言（例如“Tauri updater 清单格式”）不构成分支依据。
const PROVIDER_IDENTITY_PATTERNS: &[&str] = &[
    "\"tauri\"",
    "\"fixture-app\"",
    "\"electron\"",
    "\"wails\"",
    "TAURI_PROVIDER_ID",
    "FIXTURE_PROVIDER_ID",
    "TauriProjectProvider",
    "FixtureAppProvider",
    "::tauri",
    "::fixture",
];

/// 核心合同测试不得依赖 Fixture Provider：删除 Fixture 注册后它们必须独立
/// 通过。按目录遍历全部合同测试，只豁免 Fixture 自己的测试与本守卫。
const CONTRACT_TEST_DIRS: &[&str] = &[
    "crates/publish-domain/tests",
    "crates/publish-planner/tests",
    "crates/publish-runner-core/tests",
    "crates/publish-adapters/tests",
    "crates/one-publish-runner/tests",
];

const FIXTURE_OWNED_TESTS: &[&str] = &[
    "crates/publish-adapters/tests/fixture_provider.rs",
    "crates/publish-adapters/tests/provider_neutrality.rs",
    "crates/publish-runner-core/tests/fixture_provider_roundtrip.rs",
];

const FIXTURE_SYMBOLS: &[&str] = &[
    "\"fixture-app\"",
    "FIXTURE_PROVIDER_ID",
    "FixtureAppProvider",
    "::fixture",
];

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .ancestors()
        .nth(2)
        .expect("publish-adapters lives two levels below the workspace root")
        .to_path_buf()
}

fn rust_sources_under(directory: &Path) -> Vec<PathBuf> {
    let entries = std::fs::read_dir(directory)
        .unwrap_or_else(|error| panic!("list {}: {error}", directory.display()));
    let mut sources = Vec::new();
    for entry in entries {
        let path = entry
            .unwrap_or_else(|error| panic!("list {}: {error}", directory.display()))
            .path();
        if path.is_dir() {
            sources.extend(rust_sources_under(&path));
        } else if path.extension().is_some_and(|extension| extension == "rs") {
            sources.push(path);
        }
    }
    sources.sort();
    sources
}

/// 剥离模块声明与 use/re-export 语句（含跨行列表）；其余行原样保留。
fn strip_module_wiring(source: &str) -> String {
    let mut kept = Vec::new();
    let mut in_use_statement = false;
    for line in source.lines() {
        let trimmed = line.trim_start();
        if in_use_statement {
            in_use_statement = !trimmed.contains(';');
            continue;
        }
        if trimmed.starts_with("use ") || trimmed.starts_with("pub use ") {
            in_use_statement = !trimmed.contains(';');
            continue;
        }
        if trimmed.starts_with("mod ") || trimmed.starts_with("pub mod ") {
            continue;
        }
        kept.push(line);
    }
    kept.join("\n")
}

fn violations(source: &str, patterns: &[&str]) -> Vec<String> {
    patterns
        .iter()
        .filter(|pattern| source.contains(*pattern))
        .map(|pattern| (*pattern).to_string())
        .collect()
}

fn scan_directories(
    directories: &[&str],
    exempt_files: &[&str],
    wiring_file: Option<&str>,
    patterns: &[&str],
) -> Vec<String> {
    let root = workspace_root();
    let mut findings = Vec::new();
    for directory in directories {
        for path in rust_sources_under(&root.join(directory)) {
            let relative = path
                .strip_prefix(&root)
                .expect("scanned sources live inside the workspace")
                .to_string_lossy()
                .replace('\\', "/");
            if exempt_files.contains(&relative.as_str()) {
                continue;
            }
            let mut source = std::fs::read_to_string(&path)
                .unwrap_or_else(|error| panic!("read {}: {error}", path.display()));
            if wiring_file == Some(relative.as_str()) {
                source = strip_module_wiring(&source);
            }
            for pattern in violations(&source, patterns) {
                findings.push(format!("{relative} references {pattern}"));
            }
        }
    }
    findings
}

#[test]
fn core_and_shared_adapters_never_branch_on_provider_identities() {
    let findings = scan_directories(
        PROVIDER_NEUTRAL_SOURCE_DIRS,
        PROVIDER_IMPLEMENTATION_FILES,
        Some(MODULE_WIRING_FILE),
        PROVIDER_IDENTITY_PATTERNS,
    );
    assert!(
        findings.is_empty(),
        "provider identities leaked into provider-neutral sources:\n{}",
        findings.join("\n")
    );
}

#[test]
fn core_contract_tests_stay_independent_of_the_fixture_provider() {
    let findings = scan_directories(
        CONTRACT_TEST_DIRS,
        FIXTURE_OWNED_TESTS,
        None,
        FIXTURE_SYMBOLS,
    );
    assert!(
        findings.is_empty(),
        "core contract tests depend on the fixture provider:\n{}",
        findings.join("\n")
    );
}

/// 检测逻辑自证：名称分支的典型写法必须被上述模式抓住，防止检查空转；
/// 模块接线剥离不得吞掉分支代码。
#[test]
fn the_identity_patterns_catch_provider_branches() {
    let branch_on_id = r#"if binding.adapter.id == "tauri" { special_case(); }"#;
    let branch_on_constant = "if id == TAURI_PROVIDER_ID { special_case(); }";
    let module_import = "use crate::tauri::TauriProjectProvider;";
    let concrete_type = "let provider = FixtureAppProvider::new(root);";
    let natural_language_comment = "// The Tauri updater manifest format is an ecosystem fact.";

    assert!(!violations(branch_on_id, PROVIDER_IDENTITY_PATTERNS).is_empty());
    assert!(!violations(branch_on_constant, PROVIDER_IDENTITY_PATTERNS).is_empty());
    assert!(!violations(module_import, PROVIDER_IDENTITY_PATTERNS).is_empty());
    assert!(!violations(concrete_type, PROVIDER_IDENTITY_PATTERNS).is_empty());
    assert!(violations(natural_language_comment, PROVIDER_IDENTITY_PATTERNS).is_empty());

    let wired = "pub use tauri::{\n    TauriProjectProvider,\n};\nfn keep() {}\n";
    let stripped = strip_module_wiring(wired);
    assert!(violations(&stripped, PROVIDER_IDENTITY_PATTERNS).is_empty());
    assert!(stripped.contains("fn keep()"));
    assert!(!violations(
        &strip_module_wiring(branch_on_constant),
        PROVIDER_IDENTITY_PATTERNS
    )
    .is_empty());
}
