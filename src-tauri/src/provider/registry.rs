use super::{Provider, ProviderManifest};
use crate::compiler::{CompileError};
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
}
