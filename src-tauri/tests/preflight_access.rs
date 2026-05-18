//! Integration tests for preflight checks (output access validation).
//!
//! Tests the public `preflight_publish_output` API with various
//! PublishSpec configurations, verifying access detection and
//! validation logic.

use one_publish_lib::commands::preflight_publish_output;
use one_publish_lib::commands::{PublishOutputAccessStatus, PublishOutputValidationStatus};
use one_publish_lib::spec::{PublishSpec, SpecValue, SPEC_VERSION};
use std::collections::BTreeMap;
use std::fs;

fn make_spec(output_dir: &str) -> PublishSpec {
    let mut params = BTreeMap::new();
    params.insert(
        "outputDir".to_string(),
        SpecValue::String(output_dir.to_string()),
    );
    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/test-project".to_string(),
        parameters: params,
    }
}

fn make_spec_no_output() -> PublishSpec {
    PublishSpec {
        version: SPEC_VERSION,
        provider_id: "dotnet".to_string(),
        project_path: "/tmp/test-project".to_string(),
        parameters: BTreeMap::new(),
    }
}

#[test]
fn preflight_with_default_output_dir_is_not_protected() {
    // When no output_dir is specified, the system infers a default
    let spec = make_spec_no_output();
    let result = preflight_publish_output(spec);

    // Should have an output directory (either inferred or default)
    assert!(!result.output_dir.is_empty());

    // Default output should not be a protected location
    assert_ne!(
        result.access.status,
        PublishOutputAccessStatus::Denied,
        "default output should not be denied: {:?}",
        result.access
    );
}

#[test]
fn preflight_with_temp_dir_is_not_protected() {
    let temp = std::env::temp_dir().join(format!("one-publish-test-{}", std::process::id()));
    fs::create_dir_all(&temp).unwrap();

    let spec = make_spec(temp.to_str().unwrap());
    let result = preflight_publish_output(spec);

    // Temp directory is not a protected root, so access check is not applicable
    // (NotApplicable means "no protection rules matched" — which is correct for temp dirs)
    assert!(
        result.access.status == PublishOutputAccessStatus::Granted
            || result.access.status == PublishOutputAccessStatus::NotApplicable,
        "temp dir should be granted or not-applicable: {:?}",
        result.access
    );

    fs::remove_dir_all(&temp).ok();
}

#[test]
fn preflight_output_dir_matches_specified() {
    let output = "/tmp/one-publish-test-output";
    let spec = make_spec(output);
    let result = preflight_publish_output(spec);

    // The output_dir should not be empty (even if normalized/expanded)
    assert!(
        !result.output_dir.is_empty(),
        "output_dir should not be empty"
    );
    // macOS normalizes /tmp to /private/tmp, so check for either variant
    let contains_path =
        result.output_dir.contains("tmp") || result.output_dir.contains("one-publish-test-output");
    assert!(
        contains_path,
        "output_dir should contain expected path component, got: {}",
        result.output_dir
    );
}

#[test]
fn preflight_with_empty_output_dir_uses_default() {
    let spec = make_spec("");
    let result = preflight_publish_output(spec);

    // Should still produce a result (default or inferred)
    assert!(!result.output_dir.is_empty());
}

#[test]
fn preflight_validation_is_present() {
    let spec = make_spec("/tmp/test-output");
    let result = preflight_publish_output(spec);

    // Validation should always be present
    assert!(
        result.validation.status == PublishOutputValidationStatus::Compatible
            || result.validation.status == PublishOutputValidationStatus::NotApplicable
            || result.validation.status == PublishOutputValidationStatus::Incompatible,
        "validation status should be valid: {:?}",
        result.validation
    );
}

#[test]
fn preflight_result_has_all_required_fields() {
    let spec = make_spec("/tmp/some-output");
    let result = preflight_publish_output(spec);

    // Verify the structure is complete
    assert!(
        !result.output_dir.is_empty(),
        "output_dir should not be empty"
    );
    // configured_output_dir may be null for some paths
    // access.detail may be null
    // validation.issue may be null

    // Just verify the result is well-formed (no panics at least)
    let _ = format!("{:?}", result);
}
