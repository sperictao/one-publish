use publish_domain::{is_artifact_role_wildcard, is_safe_portable_relative_path, is_sha256_digest};

/// 可移植相对路径是 bundle/manifest 落盘前最后的穿越防线：
/// 拒绝绝对路径、上级引用、驱动器分隔与 Windows 反斜杠变体。
#[test]
fn safe_portable_paths_accept_plain_relative_entries() {
    for path in ["a/b.txt", "dir/sub/file.zip", "file", "a-b_c.d"] {
        assert!(
            is_safe_portable_relative_path(path),
            "expected safe: {path}"
        );
    }
}

#[test]
fn portable_path_rejects_traversal_and_absolute_forms() {
    for path in [
        "/abs/path",
        "/",
        "../x",
        "a/../b",
        "..",
        "a//b",
        "a\\b",
        "a:b",
        "a\0b",
        "a/",
    ] {
        assert!(
            !is_safe_portable_relative_path(path),
            "expected rejected: {path:?}"
        );
    }
}

#[test]
fn portable_path_rejects_empty_and_dot_components() {
    // trim 后为空与逐组件 "." 同属拒绝集；裸 "." 即当前目录引用。
    for path in ["", "   ", "./a", "a/./b", "."] {
        assert!(
            !is_safe_portable_relative_path(path),
            "expected rejected: {path:?}"
        );
    }
}

#[test]
fn portable_path_accepts_dotfile_components() {
    // ".hidden" 不是 "." 组件——点号文件属合法相对路径。
    assert!(is_safe_portable_relative_path(".hidden"));
    assert!(is_safe_portable_relative_path("a/.b"));
}

#[test]
fn sha256_digest_accepts_64_hex_case_insensitive() {
    assert!(is_sha256_digest(&"a".repeat(64)));
    assert!(is_sha256_digest(&"0123456789abcdef".repeat(4)));
    // is_ascii_hexdigit 同时接受大写——digest 比较方须自行归一化语义。
    assert!(is_sha256_digest(&"A".repeat(64)));
}

#[test]
fn sha256_digest_rejects_bad_length_and_alphabet() {
    assert!(!is_sha256_digest(&"a".repeat(63)));
    assert!(!is_sha256_digest(&"a".repeat(65)));
    assert!(!is_sha256_digest(""));
    assert!(!is_sha256_digest(&"g".repeat(64)));
    // 非 ASCII 十六进制（全角数字）必须拒绝。
    assert!(!is_sha256_digest(&"１２３４５６７８９０abcdef".repeat(2)));
}

#[test]
fn artifact_role_wildcard_only_matches_suffix_star() {
    assert!(is_artifact_role_wildcard("artifact:*"));
    assert!(is_artifact_role_wildcard("provider-output:*"));
    for entry in ["*", "a:", "a:b", "", "artifact", "x:*:y", ":*:"] {
        assert!(
            !is_artifact_role_wildcard(entry),
            "expected non-wildcard: {entry:?}"
        );
    }
}
