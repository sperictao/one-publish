use crate::plan::{ExecutionPlan, PlanStep, PLAN_VERSION};
use crate::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;

#[derive(Debug, thiserror::Error)]
pub enum CompileError {
  #[error("unsupported spec version: {0}")]
  UnsupportedSpecVersion(u32),

  #[error("unsupported provider: {0}")]
  UnsupportedProvider(String),
}

pub fn compile(spec: &PublishSpec) -> Result<ExecutionPlan, CompileError> {
  if spec.version != SPEC_VERSION {
    return Err(CompileError::UnsupportedSpecVersion(spec.version));
  }

  match spec.provider_id.as_str() {
    "dotnet" => Ok(compile_dotnet(spec)),
    other => Err(CompileError::UnsupportedProvider(other.to_string())),
  }
}

fn compile_dotnet(spec: &PublishSpec) -> ExecutionPlan {
  let mut payload = BTreeMap::<String, serde_json::Value>::new();

  payload.insert("project_path".to_string(), serde_json::Value::String(spec.project_path.clone()));

  // Carry parameters through to the step payload for observability.
  payload.insert(
    "parameters".to_string(),
    spec_value_to_json(SpecValue::Map(spec.parameters.clone())),
  );

  let step = PlanStep {
    id: "dotnet.publish".to_string(),
    title: "dotnet publish".to_string(),
    kind: "process".to_string(),
    payload,
  };

  ExecutionPlan {
    version: PLAN_VERSION,
    spec: spec.clone(),
    steps: vec![step],
  }
}

fn spec_value_to_json(v: SpecValue) -> serde_json::Value {
  match v {
    SpecValue::Null => serde_json::Value::Null,
    SpecValue::Bool(b) => serde_json::Value::Bool(b),
    SpecValue::Number(n) => {
      serde_json::Number::from_f64(n).map(serde_json::Value::Number).unwrap_or(serde_json::Value::Null)
    }
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
  use crate::spec::{PublishSpec, SpecValue};

  #[test]
  fn dotnet_spec_compiles_to_single_publish_step() {
    let mut params = BTreeMap::new();
    params.insert("configuration".to_string(), SpecValue::String("Release".to_string()));

    let spec = PublishSpec {
      version: SPEC_VERSION,
      provider_id: "dotnet".to_string(),
      project_path: "/tmp/demo.csproj".to_string(),
      parameters: params,
    };

    let plan = compile(&spec).expect("compile");
    assert_eq!(plan.version, PLAN_VERSION);
    assert_eq!(plan.steps.len(), 1);
    assert_eq!(plan.steps[0].id, "dotnet.publish");
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
