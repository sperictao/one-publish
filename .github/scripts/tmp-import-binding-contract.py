from pathlib import Path

path = Path('src-tauri/src/config_export.rs')
text = path.read_text()

binding_block = '''        if let Some(project_binding) = profile.project_binding.as_deref() {
            if crate::publish_runtime::project_binding_selector(&profile.provider_id, project_binding)
                .is_none()
            {
                return Err(ImportError::ValidationFailed(format!(
                    "profile '{}' project binding '{}' does not belong to provider '{}'",
                    profile.name, project_binding, profile.provider_id
                )));
            }
        }

'''
assert text.count(binding_block) == 1, 'expected exactly one binding validation block'
text = text.replace(binding_block, '', 1)

anchor = '''        // Check if provider exists
        let Ok(provider) = registry.get(&profile.provider_id) else {
'''
assert anchor in text, 'provider lookup anchor not found'
text = text.replace(anchor, binding_block + anchor, 1)

old = '            project_binding: Some("cargo:App.csproj".to_string()),\n            parameters: BTreeMap::from([('
new = '            project_binding: Some("dotnet:future-selector".to_string()),\n            parameters: BTreeMap::from([('
assert old in text, 'future binding test anchor not found'
text = text.replace(old, new, 1)

old = '''    fn validate_rejects_current_project_binding_not_owned_by_provider() {
        for project_binding in ["cargo:App.csproj", "dotnet:"] {
            let profile = ConfigProfile {
                name: "Binding mismatch".to_string(),
                provider_id: "dotnet".to_string(),
                project_binding: Some(project_binding.to_string()),
                parameters: BTreeMap::new(),
'''
new = '''    fn validate_rejects_project_binding_not_owned_by_provider() {
        for (project_binding, provider_version) in [
            ("cargo:App.csproj", "1"),
            ("dotnet:", "1"),
            ("cargo:future-selector", "999"),
        ] {
            let profile = ConfigProfile {
                name: "Binding mismatch".to_string(),
                provider_id: "dotnet".to_string(),
                provider_version: provider_version.to_string(),
                project_binding: Some(project_binding.to_string()),
                parameters: BTreeMap::new(),
'''
assert old in text, 'binding test anchor not found'
text = text.replace(old, new, 1)
text = text.replace(
    '.expect_err("current project binding must belong to its provider");',
    '.expect_err("project binding must belong to its provider regardless of provider version");',
    1,
)

path.write_text(text)
