use crate::spec::PublishSpec;
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;

pub const PLAN_VERSION: u32 = 1;

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct ExecutionPlan {
    pub version: u32,
    pub spec: PublishSpec,
    pub steps: Vec<PlanStep>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PlanStep {
    pub id: String,
    pub title: String,
    pub kind: String,
    pub payload: BTreeMap<String, serde_json::Value>,
}
