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
}

impl AppError {
    pub fn unknown(message: impl Into<String>) -> Self {
        Self {
            kind: ErrorKind::Unknown,
            message: message.into(),
            details: None,
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
            },
            CompileError::UnsupportedProvider(p) => Self {
                kind: ErrorKind::UnsupportedProvider,
                message: format!("unsupported provider: {p}"),
                details: None,
            },
            CompileError::RenderError(msg) => Self {
                kind: ErrorKind::RenderError,
                message: format!("parameter render error: {}", msg),
                details: Some(msg),
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

        let e: AppError = CompileError::UnsupportedSpecVersion(999).into();
        assert_eq!(e.kind, ErrorKind::UnsupportedSpecVersion);
    }
}
