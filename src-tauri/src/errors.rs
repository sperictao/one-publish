use crate::compiler::CompileError;
use serde::Serialize;

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum ErrorKind {
    Unknown,
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
}

impl From<CompileError> for AppError {
    fn from(err: CompileError) -> Self {
        match err {
            CompileError::UnsupportedSpecVersion(v) => Self {
                kind: ErrorKind::UnsupportedSpecVersion,
                message: format!("unsupported spec version: {v}"),
                details: None,
                code: Some("unsupported_spec_version".to_string()),
            },
            CompileError::UnsupportedProvider(p) => Self {
                kind: ErrorKind::UnsupportedProvider,
                message: format!("unsupported provider: {p}"),
                details: None,
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

        let e: AppError = CompileError::UnsupportedSpecVersion(999).into();
        assert_eq!(e.kind, ErrorKind::UnsupportedSpecVersion);
        assert_eq!(e.code.as_deref(), Some("unsupported_spec_version"));
    }
}
