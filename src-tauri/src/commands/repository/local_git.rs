use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::store::Branch;

use super::{repository_error, RepositoryBranchScanResult};

#[derive(Debug, Clone)]
struct GitLayout {
    git_dir: PathBuf,
    common_dir: PathBuf,
}

fn read_trimmed(path: &Path) -> Option<String> {
    fs::read_to_string(path)
        .ok()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty())
}

fn resolve_relative(base: &Path, value: &str) -> PathBuf {
    let path = PathBuf::from(value.trim());
    if path.is_absolute() {
        path
    } else {
        base.join(path)
    }
}

fn resolve_git_layout(repository_root: &Path) -> Option<GitLayout> {
    let dot_git = repository_root.join(".git");
    let git_dir = if dot_git.is_dir() {
        dot_git
    } else if dot_git.is_file() {
        let pointer = fs::read_to_string(&dot_git).ok()?;
        let raw_git_dir = pointer
            .lines()
            .find_map(|line| line.trim().strip_prefix("gitdir:"))?
            .trim();
        resolve_relative(repository_root, raw_git_dir)
    } else {
        return None;
    };

    if !git_dir.is_dir() {
        return None;
    }

    let common_dir = read_trimmed(&git_dir.join("commondir"))
        .map(|value| resolve_relative(&git_dir, &value))
        .filter(|path| path.is_dir())
        .unwrap_or_else(|| git_dir.clone());

    Some(GitLayout {
        git_dir,
        common_dir,
    })
}

fn current_branch(layout: &GitLayout) -> Option<String> {
    let head = read_trimmed(&layout.git_dir.join("HEAD"))?;
    head.strip_prefix("ref: refs/heads/")
        .map(str::trim)
        .filter(|branch| !branch.is_empty())
        .map(ToOwned::to_owned)
}

fn collect_loose_branches(common_dir: &Path, branches: &mut BTreeSet<String>) {
    let heads_dir = common_dir.join("refs").join("heads");
    if !heads_dir.is_dir() {
        return;
    }

    for entry in walkdir::WalkDir::new(&heads_dir)
        .follow_links(false)
        .into_iter()
        .filter_map(Result::ok)
    {
        if !entry.file_type().is_file() {
            continue;
        }

        let Ok(relative) = entry.path().strip_prefix(&heads_dir) else {
            continue;
        };
        let name = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        if !name.is_empty() {
            branches.insert(name);
        }
    }
}

fn collect_packed_branches(common_dir: &Path, branches: &mut BTreeSet<String>) {
    let Ok(content) = fs::read_to_string(common_dir.join("packed-refs")) else {
        return;
    };

    for line in content.lines().map(str::trim) {
        if line.is_empty() || line.starts_with('#') || line.starts_with('^') {
            continue;
        }

        let mut fields = line.split_whitespace();
        let _object_id = fields.next();
        let Some(reference) = fields.next() else {
            continue;
        };
        if let Some(name) = reference.strip_prefix("refs/heads/") {
            if !name.is_empty() {
                branches.insert(name.to_string());
            }
        }
    }
}

fn section_matches(line: &str, section: &str, subsection: Option<&str>) -> bool {
    let Some(inner) = line
        .trim()
        .strip_prefix('[')
        .and_then(|value| value.strip_suffix(']'))
    else {
        return false;
    };
    let inner = inner.trim();

    let Some(subsection) = subsection else {
        return inner.eq_ignore_ascii_case(section);
    };

    let Some(rest) = inner.strip_prefix(section) else {
        return false;
    };
    if !inner[..section.len()].eq_ignore_ascii_case(section) {
        return false;
    }

    let rest = rest.trim();
    let parsed_subsection = rest
        .strip_prefix('"')
        .and_then(|value| value.strip_suffix('"'))
        .unwrap_or(rest);
    parsed_subsection == subsection
}

fn trim_config_value(value: &str) -> String {
    let value = value.trim();
    value
        .strip_prefix('"')
        .and_then(|inner| inner.strip_suffix('"'))
        .unwrap_or(value)
        .trim()
        .to_string()
}

fn git_config_value(
    content: &str,
    section: &str,
    subsection: Option<&str>,
    key: &str,
) -> Option<String> {
    let mut in_target_section = false;

    for raw_line in content.lines() {
        let line = raw_line.trim();
        if line.is_empty() || line.starts_with('#') || line.starts_with(';') {
            continue;
        }

        if line.starts_with('[') {
            in_target_section = section_matches(line, section, subsection);
            continue;
        }

        if !in_target_section {
            continue;
        }

        let Some((raw_key, raw_value)) = line.split_once('=') else {
            continue;
        };
        if raw_key.trim().eq_ignore_ascii_case(key) {
            let value = trim_config_value(raw_value);
            if !value.is_empty() {
                return Some(value);
            }
        }
    }

    None
}

pub(super) fn scan_repository_branches(
    path: &str,
    repository_root: &Path,
) -> Result<RepositoryBranchScanResult, crate::errors::AppError> {
    let layout = resolve_git_layout(repository_root).ok_or_else(|| {
        repository_error(
            format!("not a git repository: {}", repository_root.display()),
            "not_git_repo",
        )
    })?;

    let head_branch = current_branch(&layout);
    let mut branch_names = BTreeSet::new();
    collect_loose_branches(&layout.common_dir, &mut branch_names);
    collect_packed_branches(&layout.common_dir, &mut branch_names);

    // An unborn branch is present in HEAD before refs/heads/<name> exists.
    // Preserve it so passive startup can still display the actual branch.
    if let Some(branch) = head_branch.as_ref() {
        branch_names.insert(branch.clone());
    }

    if branch_names.is_empty() {
        return Err(repository_error(
            "no git branches found in repository",
            "no_branches",
        ));
    }

    let current_branch = head_branch
        .filter(|branch| branch_names.contains(branch))
        .unwrap_or_else(|| branch_names.iter().next().cloned().unwrap_or_default());

    let branches = branch_names
        .into_iter()
        .map(|name| Branch {
            is_main: matches!(name.as_str(), "main" | "master"),
            is_current: name == current_branch,
            path: path.to_string(),
            name,
            commit_count: None,
        })
        .collect();

    Ok(RepositoryBranchScanResult {
        branches,
        current_branch,
    })
}

pub(super) fn branch_connectivity(
    repository_root: &Path,
    requested_branch: Option<&str>,
) -> bool {
    let Some(layout) = resolve_git_layout(repository_root) else {
        return false;
    };

    let branch = requested_branch
        .map(str::trim)
        .filter(|value| !value.is_empty() && *value != "HEAD")
        .map(ToOwned::to_owned)
        .or_else(|| current_branch(&layout));
    let Some(branch) = branch else {
        return false;
    };

    let Ok(config) = fs::read_to_string(layout.common_dir.join("config")) else {
        return false;
    };

    let Some(remote) = git_config_value(&config, "branch", Some(&branch), "remote") else {
        return false;
    };
    if remote == "." {
        return false;
    }

    let Some(merge_ref) = git_config_value(&config, "branch", Some(&branch), "merge") else {
        return false;
    };
    if !merge_ref.starts_with("refs/heads/") {
        return false;
    }

    git_config_value(&config, "remote", Some(&remote), "url")
        .is_some_and(|url| !url.trim().is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn write(path: impl AsRef<Path>, content: &str) {
        let path = path.as_ref();
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).expect("create parent dir");
        }
        fs::write(path, content).expect("write fixture");
    }

    #[test]
    fn passive_scan_reads_head_loose_and_packed_refs_without_git_process() {
        let temp = TempDir::new().expect("temp dir");
        let repo = temp.path().join("repo");
        let git = repo.join(".git");

        write(git.join("HEAD"), "ref: refs/heads/main\n");
        write(git.join("refs/heads/main"), "1111111111111111111111111111111111111111\n");
        write(
            git.join("refs/heads/feature/login"),
            "2222222222222222222222222222222222222222\n",
        );
        write(
            git.join("packed-refs"),
            "# pack-refs with: peeled fully-peeled sorted\n3333333333333333333333333333333333333333 refs/heads/release/v1\n",
        );
        write(
            git.join("config"),
            "[remote \"origin\"]\n\turl = git@github.com:example/repo.git\n[branch \"main\"]\n\tremote = origin\n\tmerge = refs/heads/main\n",
        );

        let result = scan_repository_branches(repo.to_string_lossy().as_ref(), &repo)
            .expect("passive branch scan");
        let names = result
            .branches
            .iter()
            .map(|branch| branch.name.as_str())
            .collect::<Vec<_>>();

        assert_eq!(result.current_branch, "main");
        assert_eq!(names, vec!["feature/login", "main", "release/v1"]);
        assert!(result
            .branches
            .iter()
            .find(|branch| branch.name == "main")
            .is_some_and(|branch| branch.is_current));
        assert!(branch_connectivity(&repo, Some("main")));
    }

    #[test]
    fn passive_scan_supports_linked_worktree_gitdir_and_commondir() {
        let temp = TempDir::new().expect("temp dir");
        let repo = temp.path().join("worktree");
        let common = temp.path().join("common.git");
        let git_dir = common.join("worktrees").join("worktree");

        write(
            repo.join(".git"),
            &format!("gitdir: {}\n", git_dir.to_string_lossy()),
        );
        write(git_dir.join("HEAD"), "ref: refs/heads/feature/worktree\n");
        write(git_dir.join("commondir"), "../..\n");
        write(
            common.join("refs/heads/feature/worktree"),
            "4444444444444444444444444444444444444444\n",
        );
        write(
            common.join("config"),
            "[remote \"origin\"]\n\turl = https://github.com/example/repo.git\n[branch \"feature/worktree\"]\n\tremote = origin\n\tmerge = refs/heads/feature/worktree\n",
        );

        let result = scan_repository_branches(repo.to_string_lossy().as_ref(), &repo)
            .expect("linked worktree scan");

        assert_eq!(result.current_branch, "feature/worktree");
        assert_eq!(result.branches.len(), 1);
        assert!(result.branches[0].is_current);
        assert!(branch_connectivity(&repo, None));
    }

    #[test]
    fn passive_connectivity_is_false_without_tracking_remote_url() {
        let temp = TempDir::new().expect("temp dir");
        let repo = temp.path().join("repo");
        let git = repo.join(".git");

        write(git.join("HEAD"), "ref: refs/heads/main\n");
        write(git.join("refs/heads/main"), "5555555555555555555555555555555555555555\n");
        write(
            git.join("config"),
            "[branch \"main\"]\n\tremote = origin\n\tmerge = refs/heads/main\n",
        );

        assert!(!branch_connectivity(&repo, Some("main")));
    }
}
