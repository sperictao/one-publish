use std::path::PathBuf;

pub(super) fn try_parse_unc(raw: &str) -> Option<PathBuf> {
    let trimmed = raw.trim();
    if trimmed.len() < 4 {
        return None;
    }

    let bytes = trimmed.as_bytes();
    let starts_with_double_separator = (bytes[0] == b'\\' && bytes[1] == b'\\')
        || (bytes[0] == b'/' && bytes[1] == b'/');
    if !starts_with_double_separator {
        return None;
    }

    let body = &trimmed[2..];
    let next_separator = body.find(['\\', '/'])?;
    if next_separator == 0 {
        return None;
    }

    let after_server = &body[next_separator + 1..];
    if after_server.is_empty() {
        return None;
    }

    let share_end = after_server
        .find(['\\', '/'])
        .unwrap_or(after_server.len());
    if share_end == 0 {
        return None;
    }

    Some(PathBuf::from(trimmed))
}

#[cfg(test)]
mod tests {
    use super::try_parse_unc;

    #[test]
    fn accepts_backslash_unc() {
        let path = try_parse_unc("\\\\nas01\\releases\\app").expect("valid unc");
        assert_eq!(
            path.to_string_lossy(),
            "\\\\nas01\\releases\\app".to_string()
        );
    }

    #[test]
    fn accepts_forward_slash_unc() {
        assert!(try_parse_unc("//nas01/share/app").is_some());
    }

    #[test]
    fn rejects_single_leading_separator() {
        assert!(try_parse_unc("\\nas01\\share").is_none());
        assert!(try_parse_unc("/nas01/share").is_none());
    }

    #[test]
    fn rejects_missing_share() {
        assert!(try_parse_unc("\\\\nas01").is_none());
        assert!(try_parse_unc("\\\\nas01\\").is_none());
    }

    #[test]
    fn rejects_empty_server() {
        assert!(try_parse_unc("\\\\\\share\\out").is_none());
    }
}
