use crate::compiler::CompileError;
use serde::Serialize;
use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Unknown,
    Validation,
    Artifact,
    Config,
    Provider,
    Export,
    Repository,
    Publish,
    ExternalOpen,
    ExternalCommand,
    Store,
    Updater,
    Tray,
    UnsupportedProvider,
    UnsupportedSpecVersion,
    RenderError,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct AppError {
    pub kind: ErrorKind,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub code: Option<String>,
}

impl AppError {
    pub fn unknown(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Unknown,
            message: message.into(),
            details: None,
            code: None,
        }
    }

    pub fn unknown_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Unknown,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn validation(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Validation,
            message: message.into(),
            details: None,
            code: None,
        }
    }

    pub fn validation_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Validation,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn artifact_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Artifact,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn config_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Config,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn provider_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Provider,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    /// 把 Project Provider 的检查失败映射为带稳定错误码的 Provider 错误。
    pub fn from_project_inspection(error: publish_domain::PublishError) -> Self {
        match error {
            publish_domain::PublishError::ProjectInspection { code, message } => {
                Self::provider_with_code(message, code)
            }
            other => Self::provider_with_code(other.to_string(), "tauri_inspection_failed"),
        }
    }

    pub fn export_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Export,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn repository_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Repository,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn publish_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Publish,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn external_open_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::ExternalOpen,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn external_command_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::ExternalCommand,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn store_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Store,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn updater_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Updater,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn tray_with_code(message: impl Into<String>, code: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Tray,
            message: message.into(),
            details: None,
            code: Some(code.into()),
        }
    }

    pub fn render_with_details_and_code(
        message: impl Into<String>,
        details: impl Into<String>,
        code: impl Into<String>,
    ) -> Self {
        Self {
            kind: ErrorKind::RenderError,
            message: message.into(),
            details: Some(details.into()),
            code: Some(code.into()),
        }
    }

    /// 附加语言中立的技术细节（路径、分支、底层错误）；message 保持静态，
    /// 前端按 code 本地化 message 时仍可原样展示 details。
    pub fn with_details(mut self, details: impl Into<String>) -> Self {
        self.details = Some(details.into());
        self
    }
}

impl fmt::Display for AppError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{}", self.message)
    }
}

impl From<CompileError> for AppError {
    fn from(err: CompileError) -> Self {
        match err {
            CompileError::UnsupportedSpecVersion(v) => Self {
                kind: ErrorKind::UnsupportedSpecVersion,
                message: "unsupported spec version".to_string(),
                details: Some(v.to_string()),
                code: Some("unsupported_spec_version".to_string()),
            },
            CompileError::UnsupportedProvider(p) => Self {
                kind: ErrorKind::UnsupportedProvider,
                message: "unsupported provider".to_string(),
                details: Some(p),
                code: Some("unsupported_provider".to_string()),
            },
            CompileError::RenderError(msg) => Self {
                kind: ErrorKind::RenderError,
                message: format!("parameter render error: {}", msg),
                details: Some(msg),
                code: Some("render_error".to_string()),
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn maps_compile_error_to_kind() {
        let e: AppError = CompileError::UnsupportedProvider("x".to_string()).into();
        assert_eq!(e.kind, ErrorKind::UnsupportedProvider);
        assert_eq!(e.code.as_deref(), Some("unsupported_provider"));
        assert_eq!(e.message, "unsupported provider");
        assert_eq!(e.details.as_deref(), Some("x"));

        let e: AppError = CompileError::UnsupportedSpecVersion(999).into();
        assert_eq!(e.kind, ErrorKind::UnsupportedSpecVersion);
        assert_eq!(e.code.as_deref(), Some("unsupported_spec_version"));
        assert_eq!(e.details.as_deref(), Some("999"));

        let e: AppError = CompileError::RenderError("bad param".to_string()).into();
        assert_eq!(e.kind, ErrorKind::RenderError);
        assert_eq!(e.code.as_deref(), Some("render_error"));
        assert_eq!(e.details.as_deref(), Some("bad param"));
    }

    #[test]
    fn categorized_constructors_attach_kind_and_code() {
        let cases = [
            (AppError::unknown_with_code("m", "c"), ErrorKind::Unknown),
            (
                AppError::validation_with_code("m", "c"),
                ErrorKind::Validation,
            ),
            (AppError::artifact_with_code("m", "c"), ErrorKind::Artifact),
            (AppError::config_with_code("m", "c"), ErrorKind::Config),
            (AppError::provider_with_code("m", "c"), ErrorKind::Provider),
            (AppError::export_with_code("m", "c"), ErrorKind::Export),
            (
                AppError::repository_with_code("m", "c"),
                ErrorKind::Repository,
            ),
            (AppError::publish_with_code("m", "c"), ErrorKind::Publish),
            (
                AppError::external_open_with_code("m", "c"),
                ErrorKind::ExternalOpen,
            ),
            (
                AppError::external_command_with_code("m", "c"),
                ErrorKind::ExternalCommand,
            ),
            (AppError::store_with_code("m", "c"), ErrorKind::Store),
            (AppError::updater_with_code("m", "c"), ErrorKind::Updater),
            (AppError::tray_with_code("m", "c"), ErrorKind::Tray),
        ];
        for (error, kind) in cases {
            assert_eq!(error.kind, kind);
            assert_eq!(error.message, "m");
            assert_eq!(error.code.as_deref(), Some("c"));
            assert!(error.details.is_none());
            assert_eq!(format!("{error}"), "m");
        }

        let bare = AppError::unknown("plain");
        assert_eq!(bare.kind, ErrorKind::Unknown);
        assert!(bare.code.is_none());
        let bare = AppError::validation("plain");
        assert_eq!(bare.kind, ErrorKind::Validation);
        assert!(bare.code.is_none());
    }

    #[test]
    fn from_project_inspection_preserves_code_and_wrappers_get_stable_code() {
        let inspection = publish_domain::PublishError::ProjectInspection {
            code: "project_rules_failed".to_string(),
            message: "inspection failed".to_string(),
        };
        let error = AppError::from_project_inspection(inspection);
        assert_eq!(error.kind, ErrorKind::Provider);
        assert_eq!(error.code.as_deref(), Some("project_rules_failed"));
        assert_eq!(error.message, "inspection failed");

        let other = publish_domain::PublishError::Cancelled("stopped".to_string());
        let error = AppError::from_project_inspection(other);
        assert_eq!(error.kind, ErrorKind::Provider);
        assert_eq!(error.code.as_deref(), Some("tauri_inspection_failed"));
    }

    #[test]
    fn render_and_with_details_carry_language_neutral_details() {
        let error = AppError::render_with_details_and_code("render failed", "param=x", "render_x");
        assert_eq!(error.kind, ErrorKind::RenderError);
        assert_eq!(error.details.as_deref(), Some("param=x"));
        assert_eq!(error.code.as_deref(), Some("render_x"));

        let detailed = AppError::validation("m").with_details("/path/one");
        assert_eq!(detailed.details.as_deref(), Some("/path/one"));
        assert_eq!(detailed.code, None);
    }
}
