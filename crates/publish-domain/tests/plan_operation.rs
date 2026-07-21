use std::collections::BTreeMap;

use publish_domain::{PlanOperation, PublishError};

#[test]
fn structured_commands_reject_shell_interpreters() {
    let operation = PlanOperation::RunProgram {
        program: "/bin/sh".to_string(),
        args: vec!["-c".to_string(), "echo hidden side effect".to_string()],
        working_directory: None,
        environment_references: BTreeMap::new(),
    };

    assert!(matches!(
        operation.validate(),
        Err(PublishError::InvalidPlan(message)) if message.contains("shell interpreter")
    ));
}

#[test]
fn structured_commands_reject_shell_launchers_and_multiplexers() {
    for (program, args) in [
        (
            "/usr/bin/env",
            vec![
                "sh".to_string(),
                "-c".to_string(),
                "echo bypass".to_string(),
            ],
        ),
        (
            "busybox",
            vec![
                "sh".to_string(),
                "-c".to_string(),
                "echo bypass".to_string(),
            ],
        ),
        (
            "nice",
            vec![
                "sh".to_string(),
                "-c".to_string(),
                "echo bypass".to_string(),
            ],
        ),
        (
            "timeout",
            vec![
                "10".to_string(),
                "/bin/bash".to_string(),
                "-c".to_string(),
                "echo bypass".to_string(),
            ],
        ),
        ("nohup", vec!["zsh".to_string(), "script.zsh".to_string()]),
    ] {
        let operation = PlanOperation::RunProgram {
            program: program.to_string(),
            args,
            working_directory: None,
            environment_references: BTreeMap::new(),
        };

        assert!(matches!(
            operation.validate(),
            Err(PublishError::InvalidPlan(message)) if message.contains("shell interpreter")
        ));
    }
}

#[test]
fn structured_commands_keep_program_and_arguments_separate() {
    let operation = PlanOperation::RunProgram {
        program: "cargo".to_string(),
        args: vec!["build".to_string(), "--release".to_string()],
        working_directory: Some("project".to_string()),
        environment_references: BTreeMap::new(),
    };

    operation.validate().expect("structured command is valid");
}
