use crate::parameter::{ParameterRenderer, RenderError};
use crate::plan::ExecutionPlan;
use crate::provider::registry::ProviderRegistry;
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
    let registry = ProviderRegistry::new();
    let provider = registry.get(&spec.provider_id)?;
    provider.compile(spec)
}

pub fn compile_with_renderer(spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
    let registry = ProviderRegistry::new();
    let provider = registry.get(&spec.provider_id)?;

    // Get provider schema
    let schema = provider.get_schema()?;
    let renderer = ParameterRenderer::new(schema);

    // Render parameters
    let rendered = renderer.render(&spec.parameters)?;

    // For now, compile with existing compile method
    // In the future, we can integrate the rendered args into the plan
    let plan = provider.compile(spec)?;

    log::info!("Rendered args: {:?}", rendered.args);

    Ok(plan)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
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
    fn dotnet_spec_with_parameters_compiles_with_renderer() {
        let mut parameters = BTreeMap::new();
        parameters.insert(
            "configuration".to_string(),
            SpecValue::String("Release".to_string()),
        );
        parameters.insert(
            "runtime".to_string(),
            SpecValue::String("osx-arm64".to_string()),
        );
        parameters.insert("self_contained".to_string(), SpecValue::Bool(true));

        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: "/tmp/demo.csproj".to_string(),
            parameters,
        };

        let plan = compile_with_renderer(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "dotnet.publish");
    }

    #[test]
    fn cargo_spec_with_release_flag_compiles_with_renderer() {
        let mut parameters = BTreeMap::new();
        parameters.insert("release".to_string(), SpecValue::Bool(true));
        parameters.insert(
            "target".to_string(),
            SpecValue::String("x86_64-apple-darwin".to_string()),
        );

        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "cargo".to_string(),
            project_path: "/tmp/Cargo.toml".to_string(),
            parameters,
        };

        let plan = compile_with_renderer(&spec).expect("compile");
        assert_eq!(plan.steps.len(), 1);
        assert_eq!(plan.steps[0].id, "cargo.build");
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
