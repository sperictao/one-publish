pub mod types;
pub mod cargo_provider;
pub mod dotnet_provider;
pub mod go_provider;
pub mod java_provider;

pub use types::*;
pub use cargo_provider::check_cargo;
pub use dotnet_provider::check_dotnet;
pub use go_provider::check_go;
pub use java_provider::check_java;

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
    let mut default_all = vec![
        "dotnet".to_string(),
        "cargo".to_string(),
        "go".to_string(),
        "java".to_string(),
    ];
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

pub fn invalidate_environment_cache() {
    if let Ok(mut guard) = cache().lock() {
        guard.entries.clear();
    }
}

/// Run full environment check (optionally scoped by provider ids).
pub async fn check_environment(
    provider_ids: Option<Vec<String>>,
) -> Result<EnvironmentCheckResult, Box<dyn std::error::Error>> {
    let provider_ids = normalize_provider_ids(provider_ids);
    let cache_key = make_cache_key(&provider_ids);

    if let Ok(guard) = cache().lock() {
        if let Some(entry) = guard.entries.get(&cache_key) {
            if entry.cached_at.elapsed() < ENV_CACHE_TTL {
                return Ok(entry.result.clone());
            }
        }
    }

    let mut result = EnvironmentCheckResult::new();

    for provider_id in provider_ids {
        match provider_id.as_str() {
            "cargo" => {
                let status = check_cargo().await?;
                for issue in cargo_provider::detect_cargo_issues(&status) {
                    result = result.with_issue(issue);
                }
                result = result.with_provider(status);
            }
            "dotnet" => {
                let status = check_dotnet().await?;
                for issue in dotnet_provider::detect_dotnet_issues(&status) {
                    result = result.with_issue(issue);
                }
                result = result.with_provider(status);
            }
            "go" => {
                let status = check_go().await?;
                for issue in go_provider::detect_go_issues(&status) {
                    result = result.with_issue(issue);
                }
                result = result.with_provider(status);
            }
            "java" => {
                let status = check_java().await?;
                for issue in java_provider::detect_java_issues(&status) {
                    result = result.with_issue(issue);
                }
                result = result.with_provider(status);
            }
            _ => {
                result = result.with_issue(EnvironmentIssue::new(
                    IssueSeverity::Info,
                    provider_id.clone(),
                    IssueType::MissingTool,
                    format!("Unsupported provider_id: {}", provider_id),
                ));
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

    Ok(result)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_check_environment() {
        let result = check_environment(None).await.unwrap();
        // The result will depend on what's installed on the test machine
        assert!(!result.providers.is_empty());
    }
}
