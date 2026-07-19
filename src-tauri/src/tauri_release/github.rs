use super::{GitHubRepositoryIdentity, GitHubRepositoryVisibility};
use crate::errors::AppError;
use serde_json::Value;
use std::path::Path;
use std::process::Output;

pub(crate) fn parse_github_origin(origin: &str) -> Result<(String, String), AppError> {
    let trimmed = origin.trim().trim_end_matches('/');
    let repository_path = if let Some(path) = trimmed.strip_prefix("git@github.com:") {
        path
    } else if let Some(path) = trimmed.strip_prefix("https://github.com/") {
        path
    } else if let Some(path) = trimmed.strip_prefix("ssh://git@github.com/") {
        path
    } else {
        return Err(AppError::repository_with_code(
            format!("only github.com HTTPS and SSH origins are supported: {origin}"),
            "tauri_github_origin_unsupported",
        ));
    };
    let normalized = repository_path.trim_end_matches(".git");
    let mut segments = normalized.split('/');
    let owner = segments.next().unwrap_or("").trim();
    let name = segments.next().unwrap_or("").trim();
    if owner.is_empty() || name.is_empty() || segments.next().is_some() {
        return Err(AppError::repository_with_code(
            format!("invalid GitHub repository origin: {origin}"),
            "tauri_github_origin_invalid",
        ));
    }
    Ok((owner.to_string(), name.to_string()))
}

pub(crate) fn run(program: &str, args: &[&str], working_dir: &Path) -> Result<Output, AppError> {
    crate::process_utils::new_std_command(program)
        .args(args)
        .current_dir(working_dir)
        .output()
        .map_err(|error| {
            AppError::external_command_with_code(
                format!("failed to run {program} {}: {error}", args.join(" ")),
                "tauri_release_external_command_failed",
            )
        })
}

pub(crate) fn require_success(
    program: &str,
    args: &[&str],
    working_dir: &Path,
) -> Result<String, AppError> {
    let output = run(program, args, working_dir)?;
    if output.status.success() {
        return Ok(String::from_utf8_lossy(&output.stdout).trim().to_string());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    Err(AppError::external_command_with_code(
        if stderr.is_empty() {
            format!("{program} {} failed with {}", args.join(" "), output.status)
        } else {
            stderr
        },
        "tauri_release_external_command_failed",
    ))
}

pub(crate) fn inspect_repository(
    repository_root: &Path,
) -> Result<GitHubRepositoryIdentity, AppError> {
    let origin_url = require_success("git", &["remote", "get-url", "origin"], repository_root)?;
    let (owner, name) = parse_github_origin(&origin_url)?;
    let name_with_owner = format!("{owner}/{name}");
    let json = require_success(
        "gh",
        &[
            "repo",
            "view",
            &name_with_owner,
            "--json",
            "nameWithOwner,visibility,defaultBranchRef",
        ],
        repository_root,
    )?;
    let value: Value = serde_json::from_str(&json).map_err(|error| {
        AppError::external_command_with_code(
            format!("failed to parse gh repo view output: {error}"),
            "tauri_github_response_invalid",
        )
    })?;
    let returned_identity = value
        .get("nameWithOwner")
        .and_then(Value::as_str)
        .unwrap_or("");
    if !returned_identity.eq_ignore_ascii_case(&name_with_owner) {
        return Err(AppError::repository_with_code(
            format!(
                "GitHub identity mismatch: origin is {name_with_owner}, gh returned {returned_identity}"
            ),
            "tauri_github_identity_mismatch",
        ));
    }
    let visibility = match value
        .get("visibility")
        .and_then(Value::as_str)
        .unwrap_or("")
    {
        "PUBLIC" => GitHubRepositoryVisibility::Public,
        "PRIVATE" => GitHubRepositoryVisibility::Private,
        other => {
            return Err(AppError::repository_with_code(
                format!("unsupported GitHub repository visibility: {other}"),
                "tauri_github_visibility_unsupported",
            ));
        }
    };
    let default_branch = value
        .pointer("/defaultBranchRef/name")
        .and_then(Value::as_str)
        .filter(|branch| !branch.is_empty())
        .ok_or_else(|| {
            AppError::repository_with_code(
                "GitHub repository has no default branch",
                "tauri_github_default_branch_missing",
            )
        })?
        .to_string();

    Ok(GitHubRepositoryIdentity {
        owner,
        name,
        name_with_owner,
        origin_url,
        default_branch,
        visibility,
    })
}

pub(crate) fn actions_secret_names(
    repository_root: &Path,
    identity: &str,
) -> Result<Vec<String>, AppError> {
    let json = require_success(
        "gh",
        &["secret", "list", "--repo", identity, "--json", "name"],
        repository_root,
    )?;
    let value: Value = serde_json::from_str(&json).map_err(|error| {
        AppError::external_command_with_code(
            format!("failed to parse gh secret list output: {error}"),
            "tauri_github_response_invalid",
        )
    })?;
    Ok(value
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|item| item.get("name").and_then(Value::as_str))
        .map(str::to_string)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_supported_https_and_ssh_origins() {
        assert_eq!(
            parse_github_origin("https://github.com/acme/demo.git").expect("https"),
            ("acme".to_string(), "demo".to_string())
        );
        assert_eq!(
            parse_github_origin("git@github.com:acme/demo.git").expect("ssh"),
            ("acme".to_string(), "demo".to_string())
        );
    }

    #[test]
    fn rejects_github_enterprise_origins() {
        let error = parse_github_origin("git@git.example.com:acme/demo.git")
            .expect_err("GHES is unsupported");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_github_origin_unsupported")
        );

        let error = parse_github_origin("http://github.com/acme/demo.git")
            .expect_err("insecure HTTP is unsupported");
        assert_eq!(
            error.code.as_deref(),
            Some("tauri_github_origin_unsupported")
        );
    }
}
