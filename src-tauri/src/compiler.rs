use crate::parameter::RenderError;
use crate::plan::ExecutionPlan;
use crate::provider::registry::provider_registry;
use crate::spec::PublishSpec;

#[derive(Debug, thiserror::Error)]
pub enum CompileError {
    #[error("unsupported spec version: {0}")]
    UnsupportedSpecVersion(u32),

    #[error("unsupported provider: {0}")]
    UnsupportedProvider(String),

    #[error("render error: {0}")]
    RenderError(String),
}

impl From<RenderError> for CompileError {
    fn from(err: RenderError) -> Self {
        CompileError::RenderError(err.to_string())
    }
}

pub fn compile(spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
    let provider = provider_registry().get(&spec.provider_id)?;
    provider.compile(spec)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{PublishSpec, SPEC_VERSION};
    use std::collections::BTreeMap;

    #[test]
    fn dotnet_spec_compiles() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: "/tmp/demo.csproj".to_string(),
            parameters: BTreeMap::new(),
        };

        let plan = compile(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "dotnet.publish");
    }

    #[test]
    fn cargo_spec_compiles() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "cargo".to_string(),
            project_path: "/tmp/Cargo.toml".to_string(),
            parameters: BTreeMap::new(),
        };

        let plan = compile(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "cargo.build");
    }

    #[test]
    fn tauri_spec_compiles_as_independent_build_step() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "tauri".to_string(),
            project_path: "/tmp/src-tauri/tauri.conf.json".to_string(),
            parameters: BTreeMap::new(),
        };

        let plan = compile(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "tauri.build");
    }

    #[test]
    fn go_spec_compiles() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "go".to_string(),
            project_path: "/tmp/go.mod".to_string(),
            parameters: BTreeMap::new(),
        };

        let plan = compile(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "go.build");
    }

    #[test]
    fn java_spec_compiles() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "java".to_string(),
            project_path: "/tmp/build.gradle".to_string(),
            parameters: BTreeMap::new(),
        };

        let plan = compile(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "gradle.build");
    }

    #[test]
    fn plan_json_roundtrip() {
        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: "/tmp/demo.csproj".to_string(),
            parameters: BTreeMap::new(),
        };

        let plan = compile(&spec).expect("compile");
        let json = serde_json::to_string(&plan).expect("serialize");
        let decoded: ExecutionPlan = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, plan);
    }
}
