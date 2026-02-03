use super::{Provider, ProviderManifest};
use crate::compiler::CompileError;
use crate::parameter::{load_schema_from_file, ParameterSchema, RenderError};
use crate::plan::{ExecutionPlan, PlanStep, PLAN_VERSION};
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;

pub struct ProviderRegistry {
  providers: Vec<Box<dyn Provider>>,
}

impl ProviderRegistry {
  pub fn new() -> Self {
    Self {
      providers: vec![
        Box::new(DotnetProvider::new()),
        Box::new(CargoProvider::new()),
        Box::new(GoProvider::new()),
        Box::new(JavaProvider::new()),
      ],
    }
  }

  pub fn get(&self, id: &str) -> Result<&dyn Provider, CompileError> {
    self
      .providers
      .iter()
      .map(|p| p.as_ref())
      .find(|p| p.manifest().id == id)
      .ok_or_else(|| CompileError::UnsupportedProvider(id.to_string()))
  }
}

fn get_schema_path(provider_id: &str) -> String {
  // Build path to schema file
  let schema_path = format!(
    "{}/src/provider/schemas/{}.json",
    env!("CARGO_MANIFEST_DIR"),
    provider_id
  );
  schema_path
}

struct DotnetProvider {
  manifest: ProviderManifest,
}

impl DotnetProvider {
  fn new() -> Self {
    Self {
      manifest: ProviderManifest {
        id: "dotnet".to_string(),
        display_name: "dotnet".to_string(),
        version: "1".to_string(),
      },
    }
  }
}

impl Provider for DotnetProvider {
  fn manifest(&self) -> &ProviderManifest {
    &self.manifest
  }

  fn get_schema(&self) -> Result<ParameterSchema, RenderError> {
    let schema_path = get_schema_path("dotnet");
    load_schema_from_file(schema_path.as_ref())
  }

  fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
    compile_single_step(
      spec,
      "dotnet.publish",
      "dotnet publish",
    )
  }
}

struct CargoProvider {
  manifest: ProviderManifest,
}

impl CargoProvider {
  fn new() -> Self {
    Self {
      manifest: ProviderManifest {
        id: "cargo".to_string(),
        display_name: "cargo".to_string(),
        version: "1".to_string(),
      },
    }
  }
}

impl Provider for CargoProvider {
  fn manifest(&self) -> &ProviderManifest {
    &self.manifest
  }

  fn get_schema(&self) -> Result<ParameterSchema, RenderError> {
    let schema_path = get_schema_path("cargo");
    load_schema_from_file(schema_path.as_ref())
  }

  fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
    compile_single_step(spec, "cargo.build", "cargo build")
  }
}

struct GoProvider {
  manifest: ProviderManifest,
}

impl GoProvider {
  fn new() -> Self {
    Self {
      manifest: ProviderManifest {
        id: "go".to_string(),
        display_name: "go".to_string(),
        version: "1".to_string(),
      },
    }
  }
}

impl Provider for GoProvider {
  fn manifest(&self) -> &ProviderManifest {
    &self.manifest
  }

  fn get_schema(&self) -> Result<ParameterSchema, RenderError> {
    let schema_path = get_schema_path("go");
    load_schema_from_file(schema_path.as_ref())
  }

  fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
    compile_single_step(spec, "go.build", "go build")
  }
}

struct JavaProvider {
  manifest: ProviderManifest,
}

impl JavaProvider {
  fn new() -> Self {
    Self {
      manifest: ProviderManifest {
        id: "java".to_string(),
        display_name: "java".to_string(),
        version: "1".to_string(),
      },
    }
  }
}

impl Provider for JavaProvider {
  fn manifest(&self) -> &ProviderManifest {
    &self.manifest
  }

  fn get_schema(&self) -> Result<ParameterSchema, RenderError> {
    let schema_path = get_schema_path("java");
    load_schema_from_file(schema_path.as_ref())
  }

  fn compile(&self, spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
    // Minimal slice: treat Java builds as Gradle wrapper builds.
    compile_single_step(spec, "gradle.build", "./gradlew build")
  }
}

fn compile_single_step(
  spec: &PublishSpec,
  step_id: &str,
  title: &str,
) -> Result<ExecutionPlan, CompileError> {
  if spec.version != SPEC_VERSION {
    return Err(CompileError::UnsupportedSpecVersion(spec.version));
  }

  let mut payload = BTreeMap::<String, serde_json::Value>::new();
  payload.insert(
    "project_path".to_string(),
    serde_json::Value::String(spec.project_path.clone()),
  );
  payload.insert(
    "parameters".to_string(),
    spec_value_to_json(SpecValue::Map(spec.parameters.clone())),
  );

  let step = PlanStep {
    id: step_id.to_string(),
    title: title.to_string(),
    kind: "process".to_string(),
    payload,
  };

  Ok(ExecutionPlan {
    version: PLAN_VERSION,
    spec: spec.clone(),
    steps: vec![step],
  })
}

fn spec_value_to_json(v: SpecValue) -> serde_json::Value {
  match v {
    SpecValue::Null => serde_json::Value::Null,
    SpecValue::Bool(b) => serde_json::Value::Bool(b),
    SpecValue::Number(n) => serde_json::Number::from_f64(n)
      .map(serde_json::Value::Number)
      .unwrap_or(serde_json::Value::Null),
    SpecValue::String(s) => serde_json::Value::String(s),
    SpecValue::List(xs) => serde_json::Value::Array(xs.into_iter().map(spec_value_to_json).collect()),
    SpecValue::Map(m) => {
      let obj = m
        .into_iter()
        .map(|(k, v)| (k, spec_value_to_json(v)))
        .collect::<serde_json::Map<String, serde_json::Value>>();
      serde_json::Value::Object(obj)
    }
  }
}

#[cfg(test)]
mod tests {
  use super::*;

  #[test]
  fn registry_resolves_dotnet_provider() {
    let r = ProviderRegistry::new();
    let p = r.get("dotnet").expect("provider");
    assert_eq!(p.manifest().id, "dotnet");
  }

  #[test]
  fn registry_resolves_cargo_provider() {
    let r = ProviderRegistry::new();
    let p = r.get("cargo").expect("provider");
    assert_eq!(p.manifest().id, "cargo");
  }

  #[test]
  fn registry_resolves_go_provider() {
    let r = ProviderRegistry::new();
    let p = r.get("go").expect("provider");
    assert_eq!(p.manifest().id, "go");
  }

  #[test]
  fn registry_resolves_java_provider() {
    let r = ProviderRegistry::new();
    let p = r.get("java").expect("provider");
    assert_eq!(p.manifest().id, "java");
  }

  #[test]
  fn registry_unknown_provider_is_error() {
    let r = ProviderRegistry::new();
    let err = match r.get("nope") {
      Ok(_) => panic!("expected error"),
      Err(e) => e,
    };

    match err {
      CompileError::UnsupportedProvider(id) => assert_eq!(id, "nope"),
      _ => panic!("unexpected error"),
    }
  }

  #[test]
  fn dotnet_provider_loads_schema() {
    let p = DotnetProvider::new();
    let schema = p.get_schema().expect("schema");
    assert!(schema.parameters.contains_key("configuration"));
    assert!(schema.parameters.contains_key("runtime"));
  }

  #[test]
  fn cargo_provider_loads_schema() {
    let p = CargoProvider::new();
    let schema = p.get_schema().expect("schema");
    assert!(schema.parameters.contains_key("release"));
    assert!(schema.parameters.contains_key("target"));
  }

  #[test]
  fn go_provider_loads_schema() {
    let p = GoProvider::new();
    let schema = p.get_schema().expect("schema");
    assert!(schema.parameters.contains_key("output"));
    assert!(schema.parameters.contains_key("tags"));
  }

  #[test]
  fn java_provider_loads_schema() {
    let p = JavaProvider::new();
    let schema = p.get_schema().expect("schema");
    assert!(schema.parameters.contains_key("task"));
    assert!(schema.parameters.contains_key("offline"));
  }
}
