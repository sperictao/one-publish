from pathlib import Path


def replace(path: str, old: str, new: str, count: int = 1) -> None:
    file = Path(path)
    text = file.read_text()
    actual = text.count(old)
    if actual != count:
        raise SystemExit(
            f"{path}: expected {count} occurrence(s), found {actual}: {old[:80]!r}"
        )
    file.write_text(text.replace(old, new, count))


replace(
    "src-tauri/src/store/migration.rs",
    """        let mut config = crate::store::types::RepoPublishConfig::default();
        config.profiles = self.profiles;
        config.bindings = self.bindings;
        config.applied_bundles = self.applied_bundles;
        config.global_v3_edit = Some(LegacyEditStateV3 {
            selected_preset: self.selected_preset,
            is_custom_mode: self.is_custom_mode,
            custom_config: self.custom_config,
        });
        config""",
    """        crate::store::types::RepoPublishConfig {
            profiles: self.profiles,
            bindings: self.bindings,
            applied_bundles: self.applied_bundles,
            global_v3_edit: Some(LegacyEditStateV3 {
                selected_preset: self.selected_preset,
                is_custom_mode: self.is_custom_mode,
                custom_config: self.custom_config,
            }),
            ..Default::default()
        }""",
)
replace(
    "src-tauri/src/store/migration.rs",
    """        let mut repo = Self {
            id: stored.id,
            name: stored.name,
            path: stored.path,
            project_file: stored.project_file,
            current_branch: stored.current_branch,
            branches: stored.branches,
            is_main: stored.is_main,
            provider_id: stored.provider_id,
            publish_config: stored.publish_config.into(),
        };
        repo""",
    """        Self {
            id: stored.id,
            name: stored.name,
            path: stored.path,
            project_file: stored.project_file,
            current_branch: stored.current_branch,
            branches: stored.branches,
            is_main: stored.is_main,
            provider_id: stored.provider_id,
            publish_config: stored.publish_config.into(),
        }""",
)
replace(
    "src-tauri/src/store/migration.rs",
    "use crate::publish_runtime::{PublishBaseRevisionRef, PublishConfigurationContent};",
    "use crate::publish_runtime::PublishConfigurationContent;",
)
replace(
    "src-tauri/src/store/migration.rs",
    """fn userprofile_base_revision(
    repo: &Repository,
    selected_preset: &str,
) -> Option<PublishBaseRevisionRef> {
    let configuration_id = selected_preset.strip_prefix("userprofile:")?;
    let profile = repo
        .publish_config
        .profiles
        .iter()
        .find(|profile| profile.id == configuration_id)?;
    Some(PublishBaseRevisionRef {
        configuration_id: configuration_id.to_string(),
        revision_id: profile.current_revision_id.clone(),
    })
}

""",
    "",
)

replace(
    "src-tauri/src/store/persistence.rs",
    """    let mut state = AppState::default();
    state.startup_notice = Some(format!(
        "检测到由更高版本 One Publish 写入的配置（schemaVersion={schema_version}，当前仅支持到 {CURRENT_STORE_SCHEMA_VERSION}）。为避免数据丢失，本版本不会读取或覆盖该配置文件，请升级 One Publish 后再修改设置。"
    ));""",
    """    let state = AppState {
        startup_notice: Some(format!(
            "检测到由更高版本 One Publish 写入的配置（schemaVersion={schema_version}，当前仅支持到 {CURRENT_STORE_SCHEMA_VERSION}）。为避免数据丢失，本版本不会读取或覆盖该配置文件，请升级 One Publish 后再修改设置。"
        )),
        ..Default::default()
    };""",
)
replace(
    "src-tauri/src/store/persistence.rs",
    "            let mut state: AppState = stored_state.into();",
    "            let state: AppState = stored_state.into();",
)

replace(
    "src-tauri/src/store/types.rs",
    """#[derive(Debug, Clone, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RepoPublishConfig {""",
    """#[derive(Debug, Clone, Default, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(rename_all = "camelCase")]
pub struct RepoPublishConfig {""",
)
replace(
    "src-tauri/src/store/types.rs",
    "    pub global_v3_edit: Option<super::migration::LegacyEditStateV3>,",
    "    pub(crate) global_v3_edit: Option<super::migration::LegacyEditStateV3>,",
)
replace(
    "src-tauri/src/store/types.rs",
    """impl Default for RepoPublishConfig {
    fn default() -> Self {
        Self {
            selection: None,
            drafts: Vec::new(),
            global_v3_edit: None,
            profiles: Vec::new(),
            bindings: Vec::new(),
            applied_bundles: Vec::new(),
        }
    }
}

""",
    "",
)

replace(
    "src-tauri/src/commands/repository/project.rs",
    "        .filter(|discovery| provider_id.is_none_or(|id| discovery.provider_id == id))",
    "        .filter(|discovery| provider_id.map_or(true, |id| discovery.provider_id == id))",
)

replace(
    "src-tauri/src/environment/mod.rs",
    ") -> Result<ProviderEnvironmentCheck, EnvironmentIssue> {",
    ") -> Result<ProviderEnvironmentCheck, Box<EnvironmentIssue>> {",
)
replace(
    "src-tauri/src/environment/mod.rs",
    "        _ => Err(unsupported_environment_provider_issue(provider_id)),",
    "        _ => Err(Box::new(unsupported_environment_provider_issue(provider_id))),",
)
replace(
    "src-tauri/src/environment/mod.rs",
    """            Err(issue) => {
                result = result.with_issue(issue);
            }""",
    """            Err(issue) => {
                result = result.with_issue(*issue);
            }""",
)

replace(
    "src-tauri/src/publish_runtime/source.rs",
    "pub enum PublishSource {",
    "#[allow(clippy::large_enum_variant)] // Serialized IPC contract; boxing would only change Rust storage semantics.\npub enum PublishSource {",
)
replace(
    "src-tauri/src/publish_runtime.rs",
    "pub enum PreparedPublishRuntime {",
    "#[allow(clippy::large_enum_variant)] // Serialized IPC contract; keep its boundary shape explicit.\npub enum PreparedPublishRuntime {",
)
replace(
    "src-tauri/src/publish_runtime.rs",
    "fn build_snapshot(\n    request: &PrepareRuntimeRequest,",
    "#[allow(clippy::too_many_arguments)] // Explicit immutable inputs make snapshot construction auditable.\nfn build_snapshot(\n    request: &PrepareRuntimeRequest,",
)

replace(
    "src-tauri/src/store/legacy_dotnet.rs",
    "    changed.then(|| Value::Object(parameters))",
    "    changed.then_some(Value::Object(parameters))",
)
