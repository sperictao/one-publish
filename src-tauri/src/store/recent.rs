use super::types::{AppState, MAX_RECENT_CONFIGS_PER_REPO, MAX_RECENT_REPOSITORIES};
use std::collections::{BTreeMap, HashSet};

pub(crate) fn normalize_recent_config_keys(keys: Vec<String>) -> Vec<String> {
    let mut normalized = Vec::new();

    for key in keys {
        let trimmed = key.trim();
        if trimmed.is_empty() || normalized.iter().any(|item| item == trimmed) {
            continue;
        }

        normalized.push(trimmed.to_string());
        if normalized.len() >= MAX_RECENT_CONFIGS_PER_REPO {
            break;
        }
    }

    normalized
}

pub(crate) fn push_recent_publish_config_state(
    recent_repo_ids: &mut Vec<String>,
    recent_config_keys_by_repo: &mut BTreeMap<String, Vec<String>>,
    repo_id: &str,
    config_key: &str,
) -> bool {
    let repo_id = repo_id.trim();
    let config_key = config_key.trim();
    if repo_id.is_empty() || config_key.is_empty() {
        return false;
    }

    let scoped = recent_config_keys_by_repo
        .entry(repo_id.to_string())
        .or_default();
    let previous_scoped = scoped.clone();
    *scoped = std::iter::once(config_key.to_string())
        .chain(
            previous_scoped
                .into_iter()
                .filter(|item| item != config_key),
        )
        .take(MAX_RECENT_CONFIGS_PER_REPO)
        .collect();

    let previous_repo_ids = recent_repo_ids.clone();
    *recent_repo_ids = std::iter::once(repo_id.to_string())
        .chain(previous_repo_ids.into_iter().filter(|item| item != repo_id))
        .take(MAX_RECENT_REPOSITORIES)
        .collect();

    let retained_repo_ids = recent_repo_ids.iter().cloned().collect::<HashSet<_>>();
    recent_config_keys_by_repo
        .retain(|id, keys| retained_repo_ids.contains(id) && !keys.is_empty());

    true
}

pub(crate) fn remove_recent_publish_config_state(
    recent_repo_ids: &mut Vec<String>,
    recent_config_keys_by_repo: &mut BTreeMap<String, Vec<String>>,
    repo_id: &str,
    config_key: &str,
) -> bool {
    let repo_id = repo_id.trim();
    let config_key = config_key.trim();
    if repo_id.is_empty() || config_key.is_empty() {
        return false;
    }

    let (removed, should_remove_repo) =
        if let Some(scoped) = recent_config_keys_by_repo.get_mut(repo_id) {
            let original_len = scoped.len();
            scoped.retain(|item| item != config_key);
            (original_len != scoped.len(), scoped.is_empty())
        } else {
            return false;
        };

    if should_remove_repo {
        recent_config_keys_by_repo.remove(repo_id);
        recent_repo_ids.retain(|item| item != repo_id);
    }

    removed || should_remove_repo
}

pub(crate) fn replace_recent_publish_config_key_state(
    recent_config_keys_by_repo: &mut BTreeMap<String, Vec<String>>,
    repo_id: &str,
    previous_key: &str,
    next_key: &str,
) -> bool {
    let repo_id = repo_id.trim();
    let previous_key = previous_key.trim();
    let next_key = next_key.trim();
    if repo_id.is_empty() || previous_key.is_empty() || next_key.is_empty() {
        return false;
    }

    let Some(scoped) = recent_config_keys_by_repo.get_mut(repo_id) else {
        return false;
    };

    if !scoped.iter().any(|item| item == previous_key) {
        return false;
    }

    *scoped = normalize_recent_config_keys(
        scoped
            .iter()
            .map(|item| {
                if item == previous_key {
                    next_key.to_string()
                } else {
                    item.clone()
                }
            })
            .collect(),
    );
    true
}

pub(crate) fn sanitize_recent_publish_state(state: &mut AppState) {
    let valid_repo_ids = state
        .repositories
        .iter()
        .map(|repo| repo.id.clone())
        .collect::<HashSet<_>>();

    let recent_config_keys_by_repo = std::mem::take(&mut state.recent_config_keys_by_repo);
    state.recent_config_keys_by_repo = recent_config_keys_by_repo
        .into_iter()
        .filter_map(|(repo_id, keys)| {
            if !valid_repo_ids.contains(&repo_id) {
                return None;
            }

            let normalized = normalize_recent_config_keys(keys);
            if normalized.is_empty() {
                return None;
            }

            Some((repo_id, normalized))
        })
        .collect();

    let mut normalized_recent_repo_ids = Vec::new();
    for repo_id in std::mem::take(&mut state.recent_repo_ids) {
        if normalized_recent_repo_ids.len() >= MAX_RECENT_REPOSITORIES {
            break;
        }

        if !valid_repo_ids.contains(&repo_id)
            || !state.recent_config_keys_by_repo.contains_key(&repo_id)
            || normalized_recent_repo_ids
                .iter()
                .any(|item| item == &repo_id)
        {
            continue;
        }

        normalized_recent_repo_ids.push(repo_id);
    }

    for repo_id in state.recent_config_keys_by_repo.keys() {
        if normalized_recent_repo_ids.len() >= MAX_RECENT_REPOSITORIES {
            break;
        }

        if normalized_recent_repo_ids
            .iter()
            .any(|item| item == repo_id)
        {
            continue;
        }

        normalized_recent_repo_ids.push(repo_id.clone());
    }

    let retained_repo_ids = normalized_recent_repo_ids
        .iter()
        .cloned()
        .collect::<HashSet<_>>();
    state.recent_repo_ids = normalized_recent_repo_ids;
    state
        .recent_config_keys_by_repo
        .retain(|repo_id, _| retained_repo_ids.contains(repo_id));
}
