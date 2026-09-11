from pathlib import Path


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    assert count == 1, f"{label}: expected 1 match, found {count}"
    return text.replace(old, new, 1)

runtime_path = Path("src-tauri/src/publish_runtime.rs")
runtime = runtime_path.read_text()

runtime = replace_once(
    runtime,
    '''    Some(format!("{provider_id}:{selector}"))\n}\n\nfn repository_relative_config(''',
    '''    Some(format!("{provider_id}:{selector}"))\n}\n\n/// Parse a Project Binding owned by the selected Provider. Bindings are opaque\n/// identities and must never be reinterpreted as a raw path when their Provider\n/// prefix does not match.\npub(crate) fn project_binding_selector<'a>(\n    provider_id: &str,\n    project_binding: &'a str,\n) -> Option<&'a str> {\n    let prefix = format!("{provider_id}:");\n    project_binding\n        .strip_prefix(&prefix)\n        .filter(|selector| !selector.trim().is_empty())\n}\n\nfn repository_relative_config(''',
    "insert project_binding_selector",
)

runtime = replace_once(
    runtime,
    '''        Some(binding) => {\n            let prefix = format!("{}:", content.provider_id);\n            let selector = binding.strip_prefix(&prefix).unwrap_or(binding);\n            let candidate = if selector == "." {''',
    '''        Some(binding) => {\n            let Some(selector) = project_binding_selector(&content.provider_id, binding) else {\n                return Err(PublishBuildFailure::Blocked(PublishBlockDiagnostic {\n                    code: "publish_runtime_project_binding_provider_mismatch".to_string(),\n                    message: format!(\n                        "project binding {binding} does not belong to provider {}",\n                        content.provider_id\n                    ),\n                }));\n            };\n            let candidate = if selector == "." {''',
    "strict runtime project binding",
)

runtime = replace_once(
    runtime,
    '''    #[test]\n    fn resolved_spec_derives_dotnet_default_output_from_run_inputs() {''',
    '''    #[test]\n    fn resolved_spec_rejects_project_binding_owned_by_another_provider() {\n        let (_dir, repository) = spec_builder_repository();\n        let content = revision_content(\n            "dotnet",\n            serde_json::json!({ "configuration": "Release" }),\n            Some("cargo:App.csproj".to_string()),\n        );\n        let source = super::PublishSource::Empty {\n            provider_id: "dotnet".to_string(),\n            project_binding: Some("cargo:App.csproj".to_string()),\n        };\n\n        let failure = super::build_resolved_spec(\n            &repository,\n            &content,\n            &super::PublishRunInputs::default(),\n            &source,\n        )\n        .expect_err("a binding owned by another provider must be blocked");\n        match failure {\n            super::PublishBuildFailure::Blocked(block) => assert_eq!(\n                block.code,\n                "publish_runtime_project_binding_provider_mismatch"\n            ),\n            other => panic!("expected a blocked project binding, got {other:?}"),\n        }\n    }\n\n    #[test]\n    fn resolved_spec_derives_dotnet_default_output_from_run_inputs() {''',
    "insert runtime mismatch test",
)

runtime_path.write_text(runtime)

source_path = Path("src-tauri/src/publish_runtime/source.rs")
source = source_path.read_text()

source = replace_once(
    source,
    '''    if content.provider_version != provider.manifest().version {''',
    '''    if let Some(project_binding) = content.project_binding.as_deref() {\n        if super::project_binding_selector(&content.provider_id, project_binding).is_none() {\n            return Some(format!(\n                "project_binding_provider_mismatch:{project_binding}"\n            ));\n        }\n    }\n\n    if content.provider_version != provider.manifest().version {''',
    "central source ownership gate",
)

source = replace_once(
    source,
    '''    let prefix = format!("{provider_id}:");\n    let selector = project_binding\n        .strip_prefix(&prefix)\n        .unwrap_or(project_binding);''',
    '''    let selector = super::project_binding_selector(provider_id, project_binding).ok_or_else(|| {\n        source_error(\n            "publish_source_project_binding_provider_mismatch",\n            format!(\n                "project binding {project_binding} does not belong to provider {provider_id}"\n            ),\n        )\n    })?;''',
    "strict project profile binding",
)

source = replace_once(
    source,
    '''    #[test]\n    fn draft_source_rejects_unknown_provider() {''',
    '''    #[test]\n    fn draft_source_marks_project_binding_provider_mismatch_blocked() {\n        let content = PublishConfigurationContent {\n            provider_id: "go".to_string(),\n            contract_version: PUBLISH_CONFIGURATION_CONTRACT_VERSION,\n            provider_version: "1".to_string(),\n            settings_version: CURRENT_SETTINGS_VERSION,\n            project_binding: Some("dotnet:App.csproj".to_string()),\n            parameters: serde_json::json!({}),\n            composition: PublishComposition::local_default(),\n        };\n\n        let resolved = resolve_publish_source_scoped(\n            &repository_fixture(),\n            &[],\n            &PublishSource::Draft {\n                content,\n                base_revision: None,\n            },\n        )\n        .expect("resolve mismatched binding draft as a blocked source");\n\n        assert_eq!(\n            resolved.blocked_reason.as_deref(),\n            Some("project_binding_provider_mismatch:dotnet:App.csproj")\n        );\n    }\n\n    #[test]\n    fn draft_source_rejects_unknown_provider() {''',
    "insert draft mismatch test",
)

source = replace_once(
    source,
    '''        let missing = resolve_publish_source_scoped(\n            &repository,\n            &[],\n            &PublishSource::ProjectProfile {''',
    '''        let mismatch = resolve_publish_source_scoped(\n            &repository,\n            &[],\n            &PublishSource::ProjectProfile {\n                provider_id: "dotnet".to_string(),\n                project_binding: Some("cargo:App.csproj".to_string()),\n                reference: "FolderProfile".to_string(),\n            },\n        )\n        .expect_err("project profile binding must belong to its provider");\n        assert_eq!(\n            mismatch.code.as_deref(),\n            Some("publish_source_project_binding_provider_mismatch")\n        );\n\n        let missing = resolve_publish_source_scoped(\n            &repository,\n            &[],\n            &PublishSource::ProjectProfile {''',
    "insert project profile mismatch test",
)

source_path.write_text(source)
