use crate::environment::{check_environment, FixAction, FixResult, FixType};
use tokio::time::{timeout, Duration};

/// Run environment check
#[tauri::command]
pub async fn run_environment_check(
    provider_ids: Option<Vec<String>>,
) -> Result<crate::environment::EnvironmentCheckResult, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new(
        "commands::environment::run_environment_check",
    );
    Ok(check_environment(provider_ids).await)
}

/// Apply a fix action
#[tauri::command]
pub async fn apply_fix(action: FixAction) -> Result<FixResult, crate::errors::AppError> {
    let _timer = crate::commands::middleware::CommandTimer::new("commands::environment::apply_fix");
    match action.action_type {
        FixType::OpenUrl => {
            let url = action.url.ok_or_else(|| {
                crate::errors::AppError::validation_with_code(
                    "URL is required for OpenUrl fix",
                    "missing_fix_url",
                )
            })?;
            validate_fix_url(&url)?;
            open::that(&url).map_err(|e| {
                crate::errors::AppError::external_open_with_code(
                    "failed to open URL",
                    "fix_open_url_failed",
                )
                .with_details(e.to_string())
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
            let resolved_program =
                crate::environment::command_path(&program).unwrap_or(program.clone());
            log::info!("Applying fix via command: {} {}", program, args.join(" "));
            let output = timeout(
                Duration::from_secs(10 * 60),
                crate::process_utils::capture_child_output_bounded(
                    crate::process_utils::new_tokio_command(&resolved_program).args(&args),
                ),
            )
            .await
            .map_err(|_| {
                crate::errors::AppError::external_command_with_code(
                    "command timed out",
                    "fix_command_timed_out",
                )
            })?
            .map_err(|e| {
                crate::errors::AppError::external_command_with_code(
                    "failed to run command",
                    "fix_command_spawn_failed",
                )
                .with_details(e.to_string())
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

/// FixAction 经 IPC 由渲染进程带回，url 与 command 同属不可信输入。
/// open::that 会把任意 scheme（file://、javascript:、已注册的外部协议）
/// 甚至无 scheme 的裸路径交给操作系统解析——与命令白名单同理收紧到
/// http(s)，并拒绝空白/控制字符，避免被当作本地文件或外部协议处理器。
fn validate_fix_url(url: &str) -> Result<(), crate::errors::AppError> {
    let lower = url.to_ascii_lowercase();
    let has_browser_scheme = lower.starts_with("https://") || lower.starts_with("http://");
    let clean = url
        .chars()
        .all(|ch| !ch.is_control() && !ch.is_whitespace());
    if !has_browser_scheme || !clean {
        return Err(crate::errors::AppError::validation_with_code(
            "unsupported URL: only http(s) links are allowed",
            "unsafe_fix_url",
        )
        .with_details(url));
    }
    Ok(())
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
            for arg in &args[1..] {
                let looks_like_formula_path =
                    arg.contains('/') || arg.contains('\\') || arg.ends_with(".rb");
                let valid_formula_name = !arg.is_empty()
                    && !arg.starts_with('-')
                    && arg.chars().all(|ch| {
                        ch.is_ascii_alphanumeric() || matches!(ch, '@' | '.' | '_' | '+' | '-')
                    });
                if looks_like_formula_path || !valid_formula_name {
                    return Err(crate::errors::AppError::validation_with_code(
                        "unsupported brew formula argument",
                        "unsafe_brew_formula_argument",
                    )
                    .with_details(*arg));
                }
            }
        }
        "winget" => {
            // 生成的修复命令固定为 `winget install <Publisher.PackageId>`。
            // 只校验 install 子命令而不约束其余参数会放行
            // --manifest/--override/--installer 等可加载任意安装定义或命令的
            // 选项——winget 本身即成任意安装/执行原语。
            let [subcommand, package_id] = args else {
                return Err(crate::errors::AppError::validation_with_code(
                    "unsupported winget command (only `winget install <package-id>` is allowed)",
                    "unsupported_winget_fix_command",
                ));
            };
            if *subcommand != "install"
                || package_id.is_empty()
                || package_id.starts_with('-')
                || !package_id
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
            {
                return Err(crate::errors::AppError::validation_with_code(
                    "unsupported winget command (only `winget install <package-id>` is allowed)",
                    "unsupported_winget_fix_command",
                ));
            }
        }
        "rustup" => {
            if args != ["update"] {
                return Err(crate::errors::AppError::validation_with_code(
                    "unsupported rustup command (only `rustup update` is allowed)",
                    "unsupported_rustup_fix_command",
                ));
            }
        }
        _ => {
            return Err(crate::errors::AppError::validation_with_code(
                "unsupported command: this program is not allowed",
                "unsupported_fix_command",
            )
            .with_details(*program));
        }
    }
    Ok((
        program.to_string(),
        args.iter().map(|part| part.to_string()).collect(),
    ))
}

#[cfg(test)]
mod tests {
    use super::{
        apply_fix, validate_and_parse_fix_command, validate_fix_url, FixAction, FixResult, FixType,
    };

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

    #[test]
    fn fix_command_parsing_reports_disallowed_program_in_details() {
        let err = validate_and_parse_fix_command("curl https://example.invalid")
            .expect_err("unknown program should fail");
        assert_eq!(err.code.as_deref(), Some("unsupported_fix_command"));
        assert_eq!(err.details.as_deref(), Some("curl"));
    }

    #[test]
    fn fix_command_parsing_allows_brew_install_multiple_packages() {
        let (program, args) =
            validate_and_parse_fix_command("brew install rustup cairo").expect("brew install");
        assert_eq!(program, "brew");
        assert_eq!(
            args,
            vec![
                "install".to_string(),
                "rustup".to_string(),
                "cairo".to_string()
            ]
        );
    }

    fn assert_unsafe_brew_formula_argument(command: &str) {
        let err = validate_and_parse_fix_command(command)
            .expect_err("formula path/option argument should fail");
        assert_eq!(err.code.as_deref(), Some("unsafe_brew_formula_argument"));
    }

    #[test]
    fn fix_command_parsing_rejects_brew_local_formula_path() {
        assert_unsafe_brew_formula_argument("brew install ./evil.rb");
        assert_unsafe_brew_formula_argument("brew install /tmp/x.rb");
        assert_unsafe_brew_formula_argument("brew install ../x");
        assert_unsafe_brew_formula_argument("brew install C:\\x");
    }

    #[test]
    fn fix_command_parsing_rejects_brew_tap_qualified_name() {
        // Intentional tightening: tap-qualified names are not used by generated fix commands.
        assert_unsafe_brew_formula_argument("brew install homebrew/cask/foo");
    }

    #[test]
    fn fix_command_parsing_rejects_brew_install_options() {
        // Intentional tightening: --cask/--formula style options are not in the allowlist.
        assert_unsafe_brew_formula_argument("brew install --cask firefox");
    }

    #[test]
    fn fix_command_parsing_rejects_empty_and_blank_commands() {
        for command in ["", "   ", "\t "] {
            let err = validate_and_parse_fix_command(command).expect_err("empty must fail");
            assert_eq!(err.code.as_deref(), Some("empty_fix_command"));
        }
    }

    #[test]
    fn fix_command_parsing_rejects_quoted_commands() {
        for command in ["brew install 'rustup'", "brew install \"rustup\""] {
            let err = validate_and_parse_fix_command(command).expect_err("quoting must fail");
            assert_eq!(err.code.as_deref(), Some("quoted_fix_command"));
        }
    }

    #[test]
    fn fix_command_parsing_rejects_sudo_prefix() {
        let err =
            validate_and_parse_fix_command("sudo brew install rustup").expect_err("sudo must fail");
        assert_eq!(err.code.as_deref(), Some("sudo_fix_command"));
    }

    #[test]
    fn fix_command_parsing_scopes_winget_and_rustup_subcommands() {
        let err = validate_and_parse_fix_command("winget remove rustup")
            .expect_err("winget remove must fail");
        assert_eq!(err.code.as_deref(), Some("unsupported_winget_fix_command"));

        let err = validate_and_parse_fix_command("rustup install stable")
            .expect_err("rustup install must fail");
        assert_eq!(err.code.as_deref(), Some("unsupported_rustup_fix_command"));

        let (program, args) =
            validate_and_parse_fix_command("rustup update").expect("rustup update is allowed");
        assert_eq!(program, "rustup");
        assert_eq!(args, vec!["update".to_string()]);
    }

    #[test]
    fn fix_command_parsing_accepts_generated_winget_package_ids() {
        for command in [
            "winget install Rustlang.Rustup",
            "winget install Microsoft.DotNet.SDK.8",
            "winget install EclipseAdoptium.Temurin.21.JDK",
            "winget install Microsoft.EdgeWebView2Runtime",
            "winget install pnpm.pnpm",
        ] {
            let (program, args) =
                validate_and_parse_fix_command(command).expect("generated winget command");
            assert_eq!(program, "winget");
            assert_eq!(args[0], "install");
        }
    }

    #[test]
    fn fix_command_parsing_rejects_winget_options_and_extra_args() {
        // --manifest/--override/--installer 能把 winget 变成任意安装原语，
        // 生成的命令从不携带选项或第二参数，一律拒绝。
        for command in [
            "winget install --manifest",
            "winget install Rustlang.Rustup --silent",
            "winget install Rustlang.Rustup extra",
            "winget install -e",
            "winget install --override",
        ] {
            let err = validate_and_parse_fix_command(command)
                .expect_err("winget options/extra args must fail");
            assert_eq!(
                err.code.as_deref(),
                Some("unsupported_winget_fix_command"),
                "command: {command}"
            );
        }
    }

    #[test]
    fn fix_command_parsing_rejects_rustup_update_extra_args() {
        let err = validate_and_parse_fix_command("rustup update --toolchain nightly")
            .expect_err("extra args must fail");
        assert_eq!(err.code.as_deref(), Some("unsupported_rustup_fix_command"));
    }

    fn action(action_type: FixType) -> FixAction {
        FixAction {
            action_type,
            label: "fix".to_string(),
            command: None,
            url: None,
        }
    }

    #[tokio::test]
    async fn apply_fix_requires_url_for_open_url() {
        let error = apply_fix(action(FixType::OpenUrl))
            .await
            .expect_err("missing url must fail");
        assert_eq!(error.code.as_deref(), Some("missing_fix_url"));
    }

    #[tokio::test]
    async fn apply_fix_rejects_non_http_url_before_opening() {
        for url in [
            "file:///etc/passwd",
            "javascript:alert(1)",
            "smb://host/share",
            "C:\\Windows\\system32\\calc.exe",
            "https://example.com/\nfile:///etc/passwd",
        ] {
            let mut fix = action(FixType::OpenUrl);
            fix.url = Some(url.to_string());
            let error = apply_fix(fix)
                .await
                .expect_err("non-http url must fail before open");
            assert_eq!(error.code.as_deref(), Some("unsafe_fix_url"), "{url}");
        }
    }

    #[test]
    fn validate_fix_url_accepts_browser_schemes() {
        for url in [
            "https://adoptium.net/",
            "http://example.com/docs",
            "HTTPS://EXAMPLE.COM/",
        ] {
            validate_fix_url(url).expect("browser url must pass: {url}");
        }
    }

    #[tokio::test]
    async fn apply_fix_requires_command_for_run_and_copy() {
        for fix_type in [FixType::RunCommand, FixType::CopyCommand] {
            let error = apply_fix(action(fix_type))
                .await
                .expect_err("missing command must fail");
            assert_eq!(error.code.as_deref(), Some("missing_fix_command"));
        }
    }

    #[tokio::test]
    async fn apply_fix_rejects_disallowed_commands_before_spawning() {
        let mut fix = action(FixType::RunCommand);
        fix.command = Some("rm -rf /".to_string());
        let error = apply_fix(fix)
            .await
            .expect_err("disallowed program must fail");
        assert_eq!(error.code.as_deref(), Some("unsupported_fix_command"));
    }

    #[tokio::test]
    async fn apply_fix_copy_command_returns_the_payload() {
        let mut fix = action(FixType::CopyCommand);
        fix.command = Some("brew install rustup".to_string());
        let result = apply_fix(fix).await.expect("copy succeeds");
        match result {
            FixResult::CopiedToClipboard(command) => {
                assert_eq!(command, "brew install rustup")
            }
            other => panic!("expected CopiedToClipboard, got {other:?}"),
        }
    }

    #[tokio::test]
    async fn apply_fix_manual_returns_the_label() {
        let mut fix = action(FixType::Manual);
        fix.label = "安装 Xcode".to_string();
        let result = apply_fix(fix).await.expect("manual succeeds");
        match result {
            FixResult::Manual(label) => assert_eq!(label, "安装 Xcode"),
            other => panic!("expected Manual, got {other:?}"),
        }
    }
}
