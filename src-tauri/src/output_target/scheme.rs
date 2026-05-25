use std::collections::BTreeMap;

use super::RemoteUri;

pub(super) fn try_parse_remote(raw: &str) -> Option<RemoteUri> {
    let trimmed = raw.trim();
    let (scheme, rest) = split_scheme(trimmed)?;
    let (authority_and_path, query) = split_query(rest);
    let (authority, path) = split_authority_path(authority_and_path);
    let (user, host_and_port) = split_user_host(authority);
    let (host, port) = split_host_port(host_and_port)?;

    if host.is_empty() {
        return None;
    }

    Some(RemoteUri {
        scheme: scheme.to_ascii_lowercase(),
        host: host.to_string(),
        port,
        user: user.map(str::to_string),
        path: path.to_string(),
        query,
    })
}

fn split_scheme(raw: &str) -> Option<(&str, &str)> {
    let separator = raw.find("://")?;
    let scheme = &raw[..separator];
    if scheme.is_empty() || !is_valid_scheme(scheme) {
        return None;
    }
    Some((scheme, &raw[separator + 3..]))
}

fn is_valid_scheme(scheme: &str) -> bool {
    let mut chars = scheme.chars();
    let first = match chars.next() {
        Some(ch) => ch,
        None => return false,
    };
    if !first.is_ascii_alphabetic() {
        return false;
    }
    chars.all(|ch| ch.is_ascii_alphanumeric() || ch == '+' || ch == '.' || ch == '-')
}

fn split_query(rest: &str) -> (&str, BTreeMap<String, String>) {
    match rest.split_once('?') {
        Some((head, tail)) => (head, parse_query(tail)),
        None => (rest, BTreeMap::new()),
    }
}

fn parse_query(query: &str) -> BTreeMap<String, String> {
    let mut map = BTreeMap::new();
    for pair in query.split('&').filter(|item| !item.is_empty()) {
        let (key, value) = match pair.split_once('=') {
            Some((key, value)) => (key.to_string(), value.to_string()),
            None => (pair.to_string(), String::new()),
        };
        map.insert(key, value);
    }
    map
}

fn split_authority_path(input: &str) -> (&str, &str) {
    match input.find('/') {
        Some(index) => (&input[..index], &input[index..]),
        None => (input, ""),
    }
}

fn split_user_host(authority: &str) -> (Option<&str>, &str) {
    match authority.rsplit_once('@') {
        Some((user_info, host)) => {
            let user = user_info.split(':').next().unwrap_or(user_info);
            let user = if user.is_empty() { None } else { Some(user) };
            (user, host)
        }
        None => (None, authority),
    }
}

fn split_host_port(host_port: &str) -> Option<(&str, Option<u16>)> {
    if host_port.starts_with('[') {
        let end = host_port.find(']')?;
        let host = &host_port[1..end];
        let remainder = &host_port[end + 1..];
        if remainder.is_empty() {
            return Some((host, None));
        }
        let port_str = remainder.strip_prefix(':')?;
        let port = port_str.parse::<u16>().ok()?;
        return Some((host, Some(port)));
    }

    match host_port.rsplit_once(':') {
        Some((host, port_str)) => {
            let port = port_str.parse::<u16>().ok()?;
            Some((host, Some(port)))
        }
        None => Some((host_port, None)),
    }
}

#[cfg(test)]
mod tests {
    use super::try_parse_remote;

    #[test]
    fn parses_sftp_with_user_and_port() {
        let uri = try_parse_remote("sftp://deploy@build.example.com:22/var/www/app")
            .expect("valid sftp uri");
        assert_eq!(uri.scheme, "sftp");
        assert_eq!(uri.host, "build.example.com");
        assert_eq!(uri.port, Some(22));
        assert_eq!(uri.user.as_deref(), Some("deploy"));
        assert_eq!(uri.path, "/var/www/app");
        assert!(uri.query.is_empty());
    }

    #[test]
    fn parses_s3_with_query() {
        let uri = try_parse_remote("s3://bucket/prefix?region=ap-southeast-1")
            .expect("valid s3 uri");
        assert_eq!(uri.scheme, "s3");
        assert_eq!(uri.host, "bucket");
        assert_eq!(uri.path, "/prefix");
        assert_eq!(uri.query.get("region").map(String::as_str), Some("ap-southeast-1"));
    }

    #[test]
    fn strips_password_segment_from_user_info() {
        let uri = try_parse_remote("sftp://deploy:secret@host/path").expect("valid uri");
        assert_eq!(uri.user.as_deref(), Some("deploy"));
        assert_eq!(uri.host, "host");
        assert!(!format!("{:?}", uri).contains("secret"));
    }

    #[test]
    fn rejects_invalid_scheme() {
        assert!(try_parse_remote("weird scheme://host/path").is_none());
        assert!(try_parse_remote("1http://host/path").is_none());
    }

    #[test]
    fn rejects_missing_host() {
        assert!(try_parse_remote("sftp:///only-path").is_none());
    }

    #[test]
    fn rejects_non_scheme_input() {
        assert!(try_parse_remote("/Users/alice/build").is_none());
        assert!(try_parse_remote("\\\\nas01\\share\\out").is_none());
    }
}
