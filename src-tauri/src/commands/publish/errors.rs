use crate::parameter::RenderError;
use std::io::ErrorKind as IoErrorKind;

pub(crate) fn classify_process_spawn_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::NotFound => "tool_missing",
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "publish_spawn_failed",
    }
}

pub(crate) fn classify_process_wait_error(kind: IoErrorKind) -> &'static str {
    match kind {
        IoErrorKind::PermissionDenied => "permission_denied",
        _ => "publish_wait_failed",
    }
}

pub(crate) fn publish_error(
    message: impl Into<String>,
    code: impl Into<String>,
) -> crate::errors::AppError {
    crate::errors::AppError::publish_with_code(message, code)
}

pub(crate) fn publish_schema_error(source: RenderError) -> crate::errors::AppError {
    publish_error(
        format!("failed to load provider schema: {source}"),
        "publish_schema_load_failed",
    )
}

fn classify_publish_render_error_code(source: &RenderError) -> &'static str {
    match source {
        RenderError::Schema(_) => "publish_schema_load_failed",
        RenderError::UnknownParameter(_) => "publish_unknown_parameter",
        RenderError::InvalidType { .. } => "publish_invalid_parameter_type",
        RenderError::InvalidArrayTypeItem { .. } => "publish_invalid_parameter_array_item",
        RenderError::MissingPrefix(_) => "publish_missing_parameter_prefix",
        RenderError::InvalidMapValue { .. } => "publish_invalid_parameter_map_value",
    }
}

pub(crate) fn publish_render_error(source: RenderError) -> crate::errors::AppError {
    let details = source.to_string();
    crate::errors::AppError::render_with_details_and_code(
        format!("parameter render error: {details}"),
        details,
        classify_publish_render_error_code(&source),
    )
}
