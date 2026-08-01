//! 分片产物暂存层（决议 #85）：build 段候选落盘为"字节文件 + 清单"，经
//! 外壳 artifacts 暂存交接（tar 保执行位、含 run_attempt 唯一命名），汇聚
//! 段执行前导入。Artifact Store 抽象不变：导入候选重算内容摘要，Manifest
//! 密封仍以内容为准。

use std::path::{Path, PathBuf};

use publish_domain::{ArtifactCandidate, PublishError};
use serde::{Deserialize, Serialize};

/// 暂存根（相对 checkout 的确定性路径，与其它 runner 运行时目录同族）。
pub const SHARD_STAGING_DIRECTORY: &str = ".one-publish-work/staged";

#[derive(Serialize, Deserialize)]
struct StagedCandidateRecord {
    role: String,
    file_name: String,
    media_type: String,
    platform: String,
    architecture: String,
    path: String,
}

fn staging_io_error(operation: String, error: impl std::fmt::Display) -> PublishError {
    PublishError::Io {
        operation,
        message: error.to_string(),
    }
}

/// 把本段候选写进 `<root>/<affinity>/`：字节文件按序号消歧，清单记录元数据。
pub fn stage_shard_artifacts(
    root: &Path,
    affinity: &str,
    artifacts: &[ArtifactCandidate],
) -> Result<(), PublishError> {
    let segment_root = root.join(affinity);
    let files_root = segment_root.join("files");
    std::fs::create_dir_all(&files_root)
        .map_err(|error| staging_io_error(format!("create staging {affinity}"), error))?;
    let mut records = Vec::with_capacity(artifacts.len());
    for (index, artifact) in artifacts.iter().enumerate() {
        let relative = format!("files/{index}-{}", artifact.file_name);
        std::fs::write(segment_root.join(&relative), &artifact.bytes)
            .map_err(|error| staging_io_error(format!("stage {}", artifact.file_name), error))?;
        records.push(StagedCandidateRecord {
            role: artifact.role.clone(),
            file_name: artifact.file_name.clone(),
            media_type: artifact.media_type.clone(),
            platform: artifact.platform.clone(),
            architecture: artifact.architecture.clone(),
            path: relative,
        });
    }
    let manifest = serde_json::to_vec_pretty(&records)
        .map_err(|error| staging_io_error(format!("encode staging manifest {affinity}"), error))?;
    std::fs::write(segment_root.join("candidates.json"), manifest)
        .map_err(|error| staging_io_error(format!("write staging manifest {affinity}"), error))?;
    Ok(())
}

/// 读回全部段的暂存候选（按亲和目录名与清单序稳定排序）；字节重新读取，
/// 候选摘要由 `ArtifactCandidate::new` 重算——内容是唯一事实。
pub fn load_staged_artifacts(root: &Path) -> Result<Vec<ArtifactCandidate>, PublishError> {
    if !root.is_dir() {
        return Ok(Vec::new());
    }
    let mut segments: Vec<PathBuf> = std::fs::read_dir(root)
        .map_err(|error| staging_io_error(format!("read staging root {}", root.display()), error))?
        .filter_map(|entry| entry.ok().map(|entry| entry.path()))
        .filter(|path| path.is_dir())
        .collect();
    segments.sort();
    let mut artifacts = Vec::new();
    for segment in segments {
        let manifest_path = segment.join("candidates.json");
        if !manifest_path.is_file() {
            continue;
        }
        let manifest = std::fs::read(&manifest_path).map_err(|error| {
            staging_io_error(format!("read staging manifest {}", segment.display()), error)
        })?;
        let records: Vec<StagedCandidateRecord> =
            serde_json::from_slice(&manifest).map_err(|error| {
                staging_io_error(
                    format!("decode staging manifest {}", manifest_path.display()),
                    error,
                )
            })?;
        for record in records {
            if !publish_domain::is_safe_portable_relative_path(&record.path) {
                return Err(PublishError::Execution(format!(
                    "staged candidate path {} is not portable",
                    record.path
                )));
            }
            let bytes = std::fs::read(segment.join(&record.path)).map_err(|error| {
                staging_io_error(format!("read staged candidate {}", record.path), error)
            })?;
            artifacts.push(ArtifactCandidate::new(
                record.role,
                record.file_name,
                record.media_type,
                record.platform,
                record.architecture,
                bytes,
            ));
        }
    }
    Ok(artifacts)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn staged_candidates_round_trip_across_segments_with_recomputed_digests() {
        let temp = tempfile::tempdir().expect("staging root");
        let linux = ArtifactCandidate::new(
            "installer",
            "app.AppImage",
            "application/octet-stream",
            "linux",
            "x86_64",
            b"linux bytes".to_vec(),
        );
        let macos = ArtifactCandidate::new(
            "installer",
            "app.dmg",
            "application/octet-stream",
            "macos",
            "aarch64",
            b"macos bytes".to_vec(),
        );
        stage_shard_artifacts(temp.path(), "linux", std::slice::from_ref(&linux))
            .expect("stage the linux segment");
        stage_shard_artifacts(temp.path(), "macos", std::slice::from_ref(&macos))
            .expect("stage the macos segment");

        let loaded = load_staged_artifacts(temp.path()).expect("load staged candidates");
        assert_eq!(loaded, vec![linux, macos]);

        assert!(load_staged_artifacts(&temp.path().join("missing"))
            .expect("a missing staging root is an empty set")
            .is_empty());
    }
}
