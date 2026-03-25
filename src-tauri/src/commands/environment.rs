use crate::environment::{check_environment, FixAction, FixResult, FixType};
use tokio::process::Command;
use tokio::time::{timeout, Duration};

/// Run environment check
#[tauri::command]
pub async fn run_environment_check(
    provider_ids: Option<Vec<String>>,
) -> Result<crate::environment::EnvironmentCheckResult, crate::errors::AppError> {
    Ok(check_environment(provider_ids).await)
}

/// Apply a fix action
#[tauri::command]
pub async fn apply_fix(action: FixAction) -> Result<FixResult, crate::errors::AppError> {
    match action.action_type {
        FixType::OpenUrl => {
            let url = action.url.ok_or_else(|| {
                crate::errors::AppError::validation_with_code(
                    "URL is required for OpenUrl fix",
                    "missing_fix_url",
                )
            })?;
            open::that(&url).map_err(|e| {
                crate::errors::AppError::external_open_with_code(
                    format!("failed to open URL: {}", e),
                    "fix_open_url_failed",
                )
            })?;
            Ok(FixResult::OpenedUrl(url))
        }
        FixType::RunCommand => {
            let command_str = action.command.ok_or_else(|| {
                crate::errors::AppError::validation_with_code(
                    "Command is required for RunCommand fix",
                    "missing_fix_command",
                )
            })?;
            let (program, args) = validate_and_parse_fix_command(&command_str)?;
            log::info!("Applying fix via command: {} {}", program, args.join(" "));
            let output = timeout(
                Duration::from_secs(10 * 60),
                Command::new(&program).args(&args).output(),
            )
            .await
            .map_err(|_| {
                crate::errors::AppError::external_command_with_code(
                    "command timed out",
                    "fix_command_timed_out",
                )
            })?
            .map_err(|e| {
                crate::errors::AppError::unknown(format!("failed to run command: {}", e))
            })?;
            crate::environment::invalidate_environment_cache();
            Ok(FixResult::CommandExecuted {
                stdout: String::from_utf8_lossy(&output.stdout).to_string(),
                stderr: String::from_utf8_lossy(&output.stderr).to_string(),
                exit_code: output.status.code().unwrap_or(-1),
            })
        }
        FixType::CopyCommand => {
            let command_str = action.command.ok_or_else(|| {
                crate::errors::AppError::validation_with_code(
                    "Command is required for CopyCommand fix",
                    "missing_fix_command",
                )
            })?;
            Ok(FixResult::CopiedToClipboard(command_str))
        }
        FixType::Manual => Ok(FixResult::Manual(action.label)),
    }
}

fn validate_and_parse_fix_command(
    command_str: &str,
) -> Result<(String, Vec<String>), crate::errors::AppError> {
    let trimmed = command_str.trim();
    if trimmed.is_empty() {
        return Err(crate::errors::AppError::validation_with_code(
            "command is empty",
            "empty_fix_command",
        ));
    }
    if trimmed.contains('\n')
        || trimmed.contains('\r')
        || trimmed.contains('|')
        || trimmed.contains('&')
        || trimmed.contains(';')
        || trimmed.contains('>')
        || trimmed.contains('<')
    {
        return Err(crate::errors::AppError::validation_with_code(
            "unsupported command: contains unsafe shell characters",
            "unsafe_fix_command",
        ));
    }
    if trimmed.contains('"') || trimmed.contains('\'') {
        return Err(crate::errors::AppError::validation_with_code(
            "unsupported command: quoting is not allowed",
            "quoted_fix_command",
        ));
    }
    let parts: Vec<&str> = trimmed.split_whitespace().collect();
    let Some((program, args)) = parts.split_first() else {
        return Err(crate::errors::AppError::validation_with_code(
            "command is empty",
            "empty_fix_command",
        ));
    };
    if *program == "sudo" {
        return Err(crate::errors::AppError::validation_with_code(
            "unsupported command: sudo is not allowed",
            "sudo_fix_command",
        ));
    }
    match *program {
        "brew" => {
            if args.first() != Some(&"install") {
                return Err(crate::errors::AppError::validation_with_code(
                    "unsupported brew command (only `brew install ...` is allowed)",
                    "unsupported_brew_fix_command",
                ));
            }
        }
        "winget" => {
            if args.first() != Some(&"install") {
                return Err(crate::errors::AppError::validation_with_code(
                    "unsupported winget command (only `winget install ...` is allowed)",
                    "unsupported_winget_fix_command",
                ));
            }
        }
        "rustup" => {
            if args.first() != Some(&"update") {
                return Err(crate::errors::AppError::validation_with_code(
                    "unsupported rustup command (only `rustup update` is allowed)",
                    "unsupported_rustup_fix_command",
                ));
            }
        }
        _ => {
            return Err(crate::errors::AppError::validation_with_code(
                format!("unsupported command: `{}` is not allowed", program),
                "unsupported_fix_command",
            ));
        }
    }
    Ok((
        program.to_string(),
        args.iter().map(|part| part.to_string()).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::validate_and_parse_fix_command;

    #[test]
    fn fix_command_parsing_allows_brew_install() {
        let (program, args) =
            validate_and_parse_fix_command("brew install rustup").expect("brew install");
        assert_eq!(program, "brew");
        assert_eq!(args, vec!["install".to_string(), "rustup".to_string()]);
    }

    #[test]
    fn fix_command_parsing_rejects_unsafe_separator() {
        let err = validate_and_parse_fix_command("brew install rust; rm -rf /")
            .expect_err("unsafe command should fail");
        assert!(err.message.contains("unsafe shell characters"));
    }
}
