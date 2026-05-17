//! Integration tests for the publish command roundtrip.
//!
//! Tests the full publish pipeline through the public Tauri IPC API:
//! PublishSpec → render_provider_publish → preflight_publish_output.
//! Uses temp directories with real files to satisfy path existence checks.

use one_publish_lib::commands::{
    preflight_publish_output, render_provider_publish,
    PublishOutputAccessStatus,
};
use one_publish_lib::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::fs;

fn setup_project() -> (tempfile::TempDir, String) {
    let dir = tempfile::tempdir().expect("create temp dir");
    let project_path = dir.path().join("App.csproj");
    fs::write(&project_path, "<Project />").expect("write project file");
    let path_str = project_path.to_str().unwrap().to_string();
    (dir, path_str)
}

fn make_spec(project_path: &str, output_dir: &str) -> PublishSpec {
    let mut params = BTreeMap::new();
    params.insert(
        "configuration".to_string(),
        SpecValue::String("Release".to_string()),
    );
    // Use snake_case parameter names matching the dotnet schema
    if !output_dir.is_empty() {
        params.insert(
            "output".to_string(),
            SpecValue::String(output_dir.to_string()),
        );
    }
    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: project_path.to_string(),
        parameters: params,
    }
}

#[test]
fn render_dotnet_release_publish() {
    let (_dir, project_path) = setup_project();
    let spec = make_spec(&project_path, "/tmp/publish-output");
    let cmd = render_provider_publish(spec).expect("render should succeed");

    assert!(
        cmd.program.contains("dotnet"),
        "program should contain dotnet, got: {}",
        cmd.program
    );
    let args_str = cmd.args.join(" ");
    assert!(args_str.contains("publish"), "args should contain 'publish': {}", args_str);
    assert!(
        args_str.contains("configuration") || args_str.contains("Release"),
        "args should contain configuration or Release: {}",
        args_str
    );
}

#[test]
fn render_fails_for_nonexistent_project() {
    let spec = make_spec("/nonexistent/path/App.csproj", "/tmp/out");
    let result = render_provider_publish(spec);
    assert!(result.is_err(), "should fail for nonexistent path");
}

#[test]
fn render_includes_output_dir_flag() {
    let (_dir, project_path) = setup_project();
    let spec = make_spec(&project_path, "/tmp/custom-output");
    let cmd = render_provider_publish(spec).expect("render should succeed");

    let args_str = cmd.args.join(" ");
    assert!(
        args_str.contains("--output"),
        "expected --output flag, got: {}",
        args_str
    );
}

#[test]
fn render_produces_display_command() {
    let (_dir, project_path) = setup_project();
    let spec = make_spec(&project_path, "/tmp/out");
    let cmd = render_provider_publish(spec).expect("render should succeed");

    assert!(!cmd.display_command.is_empty());
    assert!(cmd.display_command.contains("dotnet"));
}

#[test]
fn preflight_after_render_is_valid() {
    let (_dir, project_path) = setup_project();
    let spec = make_spec(&project_path, "/tmp/out");
    let cmd = render_provider_publish(spec.clone()).expect("render should succeed");
    assert!(!cmd.args.is_empty());

    let result = preflight_publish_output(spec);
    assert!(!result.output_dir.is_empty());
    assert_ne!(result.access.status, PublishOutputAccessStatus::Denied);
}

#[test]
fn different_configurations_produce_different_args() {
    let (_dir, project_path) = setup_project();

    let mut release_params = BTreeMap::new();
    release_params.insert("configuration".to_string(), SpecValue::String("Release".to_string()));
    let release_spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: project_path.clone(),
        parameters: release_params,
    };

    let mut debug_params = BTreeMap::new();
    debug_params.insert("configuration".to_string(), SpecValue::String("Debug".to_string()));
    let debug_spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: project_path.clone(),
        parameters: debug_params,
    };

    let release_cmd = render_provider_publish(release_spec).expect("render release");
    let debug_cmd = render_provider_publish(debug_spec).expect("render debug");

    let release_args = release_cmd.args.join(" ");
    let debug_args = debug_cmd.args.join(" ");
    assert!(release_args.contains("Release"));
    assert!(debug_args.contains("Debug"));
    assert_ne!(release_args, debug_args);
}

#[test]
fn spec_with_multiple_flags_renders_all() {
    let (_dir, project_path) = setup_project();
    let mut params = BTreeMap::new();
    params.insert("configuration".to_string(), SpecValue::String("Release".to_string()));
    params.insert("runtime".to_string(), SpecValue::String("linux-x64".to_string()));
    params.insert("self_contained".to_string(), SpecValue::Bool(true));

    let spec = PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path,
        parameters: params,
    };

    let cmd = render_provider_publish(spec).expect("render multi-flag spec");
    let args_str = cmd.args.join(" ");
    assert!(args_str.contains("--configuration"));
    assert!(args_str.contains("Release"));
    assert!(args_str.contains("--runtime"));
    assert!(args_str.contains("linux-x64"));
    assert!(args_str.contains("--self-contained"));
}
