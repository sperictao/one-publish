use std::fs;
use std::path::{Path, PathBuf};

use sha2::{Digest, Sha256};

fn main() {
    let manifest = PathBuf::from(
        std::env::var("CARGO_MANIFEST_DIR").expect("runner manifest directory is available"),
    );
    let runner_digest = digest_sources(&[
        manifest.join("src"),
        manifest.join("build.rs"),
        manifest.join("Cargo.toml"),
        manifest.join("../../Cargo.lock"),
        manifest.join("../publish-runner-core/src"),
        manifest.join("../publish-runner-core/Cargo.toml"),
    ]);
    let plan_digest = digest_sources(&[
        manifest.join("../publish-domain/src"),
        manifest.join("../publish-domain/Cargo.toml"),
    ]);
    let adapters_digest = digest_sources(&[
        manifest.join("../publish-adapters/src"),
        manifest.join("../publish-adapters/Cargo.toml"),
    ]);

    println!("cargo:rustc-env=ONE_PUBLISH_RUNNER_SOURCE_DIGEST={runner_digest}");
    println!("cargo:rustc-env=ONE_PUBLISH_PLAN_SOURCE_DIGEST={plan_digest}");
    println!("cargo:rustc-env=ONE_PUBLISH_ADAPTERS_SOURCE_DIGEST={adapters_digest}");
}

fn digest_sources(roots: &[PathBuf]) -> String {
    let mut files = Vec::new();
    for (root_index, root) in roots.iter().enumerate() {
        if root.is_dir() {
            collect_files(root_index, root, root, &mut files);
        } else {
            files.push((
                root_index,
                root.file_name().expect("source file has a name").into(),
                root.clone(),
            ));
        }
    }
    files.sort_by(|left, right| (left.0, &left.1).cmp(&(right.0, &right.1)));

    let mut hasher = Sha256::new();
    for (root_index, relative, file) in files {
        println!("cargo:rerun-if-changed={}", file.display());
        hasher.update((root_index as u64).to_le_bytes());
        let portable_path = relative
            .components()
            .map(|component| component.as_os_str().to_string_lossy())
            .collect::<Vec<_>>()
            .join("/");
        hasher.update(portable_path.as_bytes());
        hasher.update([0]);
        hasher.update(fs::read(&file).unwrap_or_else(|error| {
            panic!("failed to read runtime source {}: {error}", file.display())
        }));
        hasher.update([0]);
    }
    hex::encode(hasher.finalize())
}

fn collect_files(
    root_index: usize,
    root: &Path,
    directory: &Path,
    files: &mut Vec<(usize, PathBuf, PathBuf)>,
) {
    let entries = fs::read_dir(directory).unwrap_or_else(|error| {
        panic!(
            "failed to read source directory {}: {error}",
            directory.display()
        )
    });
    for entry in entries {
        let path = entry.expect("source directory entry is readable").path();
        if path.is_dir() {
            collect_files(root_index, root, &path, files);
        } else {
            files.push((
                root_index,
                path.strip_prefix(root)
                    .expect("source file stays under digest root")
                    .to_path_buf(),
                path,
            ));
        }
    }
}
