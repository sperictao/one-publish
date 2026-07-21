use std::collections::BTreeMap;
use std::sync::{
    atomic::{AtomicUsize, Ordering},
    Arc,
};

use publish_adapters::{
    AdapterConformanceFixture, AdapterContract, AdapterRegistry, ProjectProvider,
};
use publish_domain::{
    AdapterBinding, AdapterDescriptor, AdapterIdentity, AdapterKind, AdapterSchema,
    AdapterSelection, AdapterSettings, PlanNodeTemplate, PlanStage, PlanningInputSnapshot,
    PublishError, PublishingCapability, SourceSnapshot, PLANNING_INPUT_SNAPSHOT_VERSION,
};
use serde_json::Value;

struct MigratingProvider {
    descriptor: AdapterDescriptor,
}

impl MigratingProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "migrating-provider",
                1,
                AdapterSchema::new(2).with_required_string("project_name"),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            ),
        }
    }
}

impl AdapterContract for MigratingProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1).with_value("name", Value::String("fixture".to_string()))
    }

    fn migrate_settings(
        &self,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        match settings.schema_version {
            1 => Ok(AdapterSettings::new(2).with_value(
                "project_name",
                settings.values.get("name").cloned().unwrap_or(Value::Null),
            )),
            2 => Ok(settings.clone()),
            actual => Err(PublishError::UnsupportedSchemaVersion {
                adapter: self.descriptor.identity().display_name(),
                actual,
                current: 2,
            }),
        }
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![PlanNodeTemplate::adapter_action(
            "inspect",
            PlanStage::InspectSource,
            "inspect_project",
            BTreeMap::from([(
                "project_name".to_string(),
                settings.values["project_name"].clone(),
            )]),
        )])
    }
}

impl ProjectProvider for MigratingProvider {}

struct NonDeterministicMigrationProvider {
    descriptor: AdapterDescriptor,
    migration_sequence: AtomicUsize,
}

impl NonDeterministicMigrationProvider {
    fn new() -> Self {
        Self {
            descriptor: MigratingProvider::new().descriptor,
            migration_sequence: AtomicUsize::new(0),
        }
    }
}

impl AdapterContract for NonDeterministicMigrationProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1).with_value("name", Value::String("fixture".to_string()))
    }

    fn migrate_settings(
        &self,
        _settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        let sequence = self.migration_sequence.fetch_add(1, Ordering::SeqCst);
        Ok(AdapterSettings::new(2)
            .with_value("project_name", Value::String(format!("fixture-{sequence}"))))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }
}

impl ProjectProvider for NonDeterministicMigrationProvider {}

struct InputSensitiveMigrationProvider {
    descriptor: AdapterDescriptor,
    migration_sequence: AtomicUsize,
}

impl InputSensitiveMigrationProvider {
    fn new() -> Self {
        Self {
            descriptor: MigratingProvider::new().descriptor,
            migration_sequence: AtomicUsize::new(0),
        }
    }
}

impl AdapterContract for InputSensitiveMigrationProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1).with_value("name", Value::String("fixture".to_string()))
    }

    fn migrate_settings(
        &self,
        settings: &AdapterSettings,
    ) -> Result<AdapterSettings, PublishError> {
        let name = settings.values.get("name").and_then(Value::as_str);
        let project_name = if name == Some("dynamic") {
            format!(
                "dynamic-{}",
                self.migration_sequence.fetch_add(1, Ordering::SeqCst)
            )
        } else {
            name.unwrap_or_default().to_string()
        };
        Ok(AdapterSettings::new(2).with_value("project_name", Value::String(project_name)))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![])
    }
}

impl ProjectProvider for InputSensitiveMigrationProvider {}

struct ShellWrapperProvider {
    descriptor: AdapterDescriptor,
}

impl ShellWrapperProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "shell-wrapper-provider",
                1,
                AdapterSchema::new(1),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            )
            .with_allowed_program("env"),
        }
    }
}

impl AdapterContract for ShellWrapperProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1)
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        _settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        Ok(vec![PlanNodeTemplate::command(
            "build",
            PlanStage::Build,
            "/usr/bin/env",
            vec!["-S".to_string(), "sh -c \"echo bypass\"".to_string()],
        )])
    }
}

impl ProjectProvider for ShellWrapperProvider {}

struct InputSensitiveFragmentProvider {
    descriptor: AdapterDescriptor,
    fragment_sequence: AtomicUsize,
}

impl InputSensitiveFragmentProvider {
    fn new() -> Self {
        Self {
            descriptor: AdapterDescriptor::new(
                AdapterKind::ProjectProvider,
                "input-sensitive-fragment",
                1,
                AdapterSchema::new(1).with_required_string("mode"),
                PublishingCapability {
                    provides: vec![],
                    requires: vec![],
                },
            ),
            fragment_sequence: AtomicUsize::new(0),
        }
    }
}

impl AdapterContract for InputSensitiveFragmentProvider {
    fn descriptor(&self) -> &AdapterDescriptor {
        &self.descriptor
    }

    fn default_settings(&self) -> AdapterSettings {
        AdapterSettings::new(1).with_value("mode", Value::String("stable".to_string()))
    }

    fn plan_fragment(
        &self,
        _snapshot: &PlanningInputSnapshot,
        settings: &AdapterSettings,
    ) -> Result<Vec<PlanNodeTemplate>, PublishError> {
        let dynamic = settings.values.get("mode").and_then(Value::as_str) == Some("dynamic");
        let sequence = dynamic.then(|| self.fragment_sequence.fetch_add(1, Ordering::SeqCst));
        Ok(vec![PlanNodeTemplate::adapter_action(
            "inspect",
            PlanStage::InspectSource,
            "inspect_project",
            BTreeMap::from([("sequence".to_string(), serde_json::json!(sequence))]),
        )])
    }
}

impl ProjectProvider for InputSensitiveFragmentProvider {}

#[test]
fn registration_runs_conformance_and_known_schema_migration() {
    let snapshot = fixture_snapshot();
    let fixture = AdapterConformanceFixture::new(snapshot);
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(MigratingProvider::new()), &fixture)
        .expect("register conformant provider");

    let identity = AdapterIdentity::new(AdapterKind::ProjectProvider, "migrating-provider", 1);
    let migrated = registry
        .migrate_and_validate_settings(
            &identity,
            &AdapterSettings::new(1).with_value("name", Value::String("desktop-app".to_string())),
        )
        .expect("migrate known schema");
    assert_eq!(migrated.schema_version, 2);
    assert_eq!(migrated.values["project_name"], "desktop-app");

    assert!(matches!(
        registry.migrate_and_validate_settings(&identity, &AdapterSettings::new(99)),
        Err(PublishError::UnsupportedSchemaVersion { actual: 99, .. })
    ));

    assert!(matches!(
        registry.migrate_and_validate_settings(
            &identity,
            &AdapterSettings::new(2)
                .with_value("project_name", Value::String("desktop-app".to_string()))
                .with_value("unexpected", Value::Bool(true)),
        ),
        Err(PublishError::InvalidAdapterSettings { message, .. })
            if message.contains("unknown setting unexpected")
    ));
}

#[test]
fn registration_rejects_non_deterministic_settings_migration() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    assert!(matches!(
        registry.register_project_provider(
            Arc::new(NonDeterministicMigrationProvider::new()),
            &fixture,
        ),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("settings migration is not deterministic")
    ));
}

#[test]
fn planning_rejects_non_deterministic_migration_for_actual_settings() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(InputSensitiveMigrationProvider::new()), &fixture)
        .expect("register provider with deterministic defaults");
    let identity = AdapterIdentity::new(AdapterKind::ProjectProvider, "migrating-provider", 1);

    assert!(matches!(
        registry.migrate_and_validate_settings(
            &identity,
            &AdapterSettings::new(1)
                .with_value("name", Value::String("dynamic".to_string())),
        ),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("settings migration is not deterministic")
    ));
}

#[test]
fn forbidden_values_are_not_echoed_in_conformance_errors() {
    let mut fixture = AdapterConformanceFixture::new(fixture_snapshot());
    fixture.forbidden_values = vec!["fixture".to_string()];
    let mut registry = AdapterRegistry::new();

    let error = registry
        .register_project_provider(Arc::new(MigratingProvider::new()), &fixture)
        .expect_err("reject forbidden value");
    assert!(!error.to_string().contains("fixture"));
}

#[test]
fn registration_rejects_raw_executables_even_when_declared_by_the_adapter() {
    let fixture = AdapterConformanceFixture::new(fixture_snapshot());
    let mut registry = AdapterRegistry::new();

    assert!(matches!(
        registry.register_project_provider(Arc::new(ShellWrapperProvider::new()), &fixture),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("opaque executable ids")
    ));
}

#[test]
fn planning_rejects_non_deterministic_fragments_for_actual_settings() {
    let snapshot = fixture_snapshot();
    let fixture = AdapterConformanceFixture::new(snapshot.clone());
    let mut registry = AdapterRegistry::new();
    registry
        .register_project_provider(Arc::new(InputSensitiveFragmentProvider::new()), &fixture)
        .expect("register provider with deterministic default fragment");
    let identity =
        AdapterIdentity::new(AdapterKind::ProjectProvider, "input-sensitive-fragment", 1);

    assert!(matches!(
        registry.plan_fragment(
            &identity,
            &snapshot,
            &AdapterSettings::new(1)
                .with_value("mode", Value::String("dynamic".to_string())),
        ),
        Err(PublishError::InvalidAdapter { message, .. })
            if message.contains("plan fragment is not deterministic")
    ));
}

fn fixture_snapshot() -> PlanningInputSnapshot {
    let empty = AdapterSettings::new(1);
    PlanningInputSnapshot {
        version: PLANNING_INPUT_SNAPSHOT_VERSION,
        configuration_revision: "revision-1".to_string(),
        runtime_revision: "runner-1".to_string(),
        release_input: BTreeMap::new(),
        source: SourceSnapshot {
            revision: "0123456789abcdef".to_string(),
            workspace_digest: None,
            dirty: false,
            captured_at: "2026-07-21T10:00:00Z".to_string(),
            reproducible: true,
        },
        external_preconditions: BTreeMap::new(),
        adapters: AdapterSelection {
            project_provider: AdapterBinding::new(
                "project",
                AdapterIdentity::new(AdapterKind::ProjectProvider, "migrating-provider", 1),
                empty.clone(),
            ),
            artifact_processors: vec![],
            execution_backend: AdapterBinding::new(
                "backend",
                AdapterIdentity::new(AdapterKind::ExecutionBackend, "backend", 1),
                empty.clone(),
            ),
            artifact_store: AdapterBinding::new(
                "store",
                AdapterIdentity::new(AdapterKind::ArtifactStore, "store", 1),
                empty.clone(),
            ),
            delivery_destinations: vec![AdapterBinding::new(
                "destination",
                AdapterIdentity::new(AdapterKind::DeliveryDestination, "destination", 1),
                empty,
            )],
        },
    }
}
