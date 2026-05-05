pub mod cargo_provider;
pub mod dotnet_provider;
pub mod go_provider;
pub mod java_provider;
pub mod types;

pub use cargo_provider::check_cargo;
pub use dotnet_provider::check_dotnet;
pub use go_provider::check_go;
pub use java_provider::check_java;
pub use types::*;

use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};

const ENV_CACHE_TTL: Duration = Duration::from_secs(5 * 60);

#[derive(Clone)]
struct EnvironmentCacheEntry {
    cached_at: Instant,
    result: EnvironmentCheckResult,
}

#[derive(Default)]
struct EnvironmentCache {
    entries: HashMap<String, EnvironmentCacheEntry>,
}

static ENVIRONMENT_CACHE: OnceLock<Mutex<EnvironmentCache>> = OnceLock::new();

fn cache() -> &'static Mutex<EnvironmentCache> {
    ENVIRONMENT_CACHE.get_or_init(|| Mutex::new(EnvironmentCache::default()))
}

fn normalize_provider_ids(provider_ids: Option<Vec<String>>) -> Vec<String> {
    let mut default_all = crate::provider::registry::provider_registry().known_ids();
    default_all.sort();

    let ids = match provider_ids {
        Some(ids) if !ids.is_empty() => ids,
        _ => return default_all,
    };

    let mut seen = HashSet::<String>::new();
    let mut normalized = Vec::new();
    for id in ids {
        let id = id.trim().to_string();
        if id.is_empty() || !seen.insert(id.clone()) {
            continue;
        }
        normalized.push(id);
    }
    normalized.sort();
    normalized
}

fn make_cache_key(provider_ids: &[String]) -> String {
    provider_ids.join(",")
}

struct ProviderEnvironmentCheck {
    status: ProviderStatus,
    issues: Vec<EnvironmentIssue>,
}

fn unsupported_environment_provider_issue(provider_id: &str) -> EnvironmentIssue {
    EnvironmentIssue::new(
        IssueSeverity::Info,
        provider_id.to_string(),
        IssueType::MissingTool,
        format!("Unsupported provider_id: {}", provider_id),
    )
}

async fn check_provider_runtime_environment(
    provider_id: &str,
) -> Result<ProviderEnvironmentCheck, EnvironmentIssue> {
    // Runtime probing stays in environment; provider registry owns catalog and discovery facts.
    match provider_id {
        "cargo" => {
            let status = check_cargo().await;
            let issues = cargo_provider::detect_cargo_issues(&status);
            Ok(ProviderEnvironmentCheck { status, issues })
        }
        "dotnet" => {
            let status = check_dotnet().await;
            let issues = dotnet_provider::detect_dotnet_issues(&status);
            Ok(ProviderEnvironmentCheck { status, issues })
        }
        "go" => {
            let status = check_go().await;
            let issues = go_provider::detect_go_issues(&status);
            Ok(ProviderEnvironmentCheck { status, issues })
        }
        "java" => {
            let status = check_java().await;
            let issues = java_provider::detect_java_issues(&status);
            Ok(ProviderEnvironmentCheck { status, issues })
        }
        _ => Err(unsupported_environment_provider_issue(provider_id)),
    }
}

pub fn invalidate_environment_cache() {
    if let Ok(mut guard) = cache().lock() {
        guard.entries.clear();
    }
}

/// Run full environment check (optionally scoped by provider ids).
pub async fn check_environment(provider_ids: Option<Vec<String>>) -> EnvironmentCheckResult {
    let provider_ids = normalize_provider_ids(provider_ids);
    let cache_key = make_cache_key(&provider_ids);

    if let Ok(guard) = cache().lock() {
        if let Some(entry) = guard.entries.get(&cache_key) {
            if entry.cached_at.elapsed() < ENV_CACHE_TTL {
                return entry.result.clone();
            }
        }
    }

    let mut result = EnvironmentCheckResult::new();

    for provider_id in provider_ids {
        match check_provider_runtime_environment(&provider_id).await {
            Ok(check) => {
                for issue in check.issues {
                    result = result.with_issue(issue);
                }
                result = result.with_provider(check.status);
            }
            Err(issue) => {
                result = result.with_issue(issue);
            }
        }
    }

    result.check_ready();

    if let Ok(mut guard) = cache().lock() {
        guard.entries.insert(
            cache_key,
            EnvironmentCacheEntry {
                cached_at: Instant::now(),
                result: result.clone(),
            },
        );
    }

    result
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_environment() {
        let result = check_environment(None).await;
        // The result will depend on what's installed on the test machine
        assert!(!result.providers.is_empty());
    }

    #[tokio::test]
    async fn unknown_provider_id_stays_scoped_to_environment_issue() {
        let result = check_environment(Some(vec!["unknown".to_string()])).await;

        assert!(result.providers.is_empty());
        assert_eq!(result.issues.len(), 1);
        assert_eq!(result.issues[0].provider_id, "unknown");
    }
}
