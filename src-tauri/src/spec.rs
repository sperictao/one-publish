use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const SPEC_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PublishSpec {
    pub version: u32,
    pub provider_id: String,
    pub project_path: String,
    pub parameters: BTreeMap<String, SpecValue>,
}

impl Default for PublishSpec {
    fn default() -> Self {
        Self {
            version: SPEC_VERSION,
            provider_id: String::new(),
            project_path: String::new(),
            parameters: BTreeMap::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum SpecValue {
    Null,
    Bool(bool),
    Number(f64),
    String(String),
    List(Vec<SpecValue>),
    Map(BTreeMap<String, SpecValue>),
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn spec_json_roundtrip_with_nested_parameters() {
        let mut parameters = BTreeMap::<String, SpecValue>::new();
        parameters.insert(
            "configuration".to_string(),
            SpecValue::String("Release".to_string()),
        );
        parameters.insert("self_contained".to_string(), SpecValue::Bool(true));

        let mut nested = BTreeMap::<String, SpecValue>::new();
        nested.insert(
            "runtime".to_string(),
            SpecValue::String("osx-arm64".to_string()),
        );
        nested.insert("trim".to_string(), SpecValue::Bool(false));
        parameters.insert("dotnet".to_string(), SpecValue::Map(nested));

        let spec = PublishSpec {
            version: SPEC_VERSION,
            provider_id: "dotnet".to_string(),
            project_path: "/tmp/demo.csproj".to_string(),
            parameters,
        };

        let json = serde_json::to_string(&spec).expect("serialize");
        let decoded: PublishSpec = serde_json::from_str(&json).expect("deserialize");
        assert_eq!(decoded, spec);
    }
}
