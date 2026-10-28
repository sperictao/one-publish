use publish_adapters::is_one_publish_owned_file;

/// CleanCheckoutGuard 只允许删除 one-publish 自产文件：
/// `.one-publish*` 前缀或 `execution-snapshot-*` 白名单扩展名。
/// 误放行的文件会被清理流程删掉——边界必须钉死。
#[test]
fn owned_files_cover_internal_prefix_and_snapshot_exports() {
    for name in [
        ".one-publish-state",
        ".one-publish-draft.json",
        "execution-snapshot-2026-07-21.md",
        "execution-snapshot-run.json",
        "execution-snapshot-n.markdown",
    ] {
        assert!(is_one_publish_owned_file(name), "expected owned: {name}");
    }
}

#[test]
fn foreign_files_are_not_owned() {
    for name in [
        "publish.zip",
        "app.dmg",
        "README.md",
        "snapshot.md",
        // 前缀不在串首 → 非自产。
        "my-execution-snapshot-x.md",
        "x.one-publish",
    ] {
        assert!(!is_one_publish_owned_file(name), "expected foreign: {name}");
    }
}

#[test]
fn snapshot_prefix_requires_whitelisted_extension() {
    // 快照前缀成立但扩展不在白名单 → 不可清理（可能含有用户产物）。
    for name in [
        "execution-snapshot-x.zip",
        "execution-snapshot-x.tar.gz",
        "execution-snapshot-x",
    ] {
        assert!(!is_one_publish_owned_file(name), "expected foreign: {name}");
    }
}

#[test]
fn snapshot_match_is_case_insensitive_but_internal_prefix_is_not() {
    // 快照判定前整体小写化——大小写混合仍可识别为自产。
    assert!(is_one_publish_owned_file("EXECUTION-SNAPSHOT-A.MD"));
    assert!(is_one_publish_owned_file("Execution-Snapshot-B.Json"));
    // `.one-publish` 前缀检查先于小写化——全大写变体不命中自产命名空间。
    assert!(!is_one_publish_owned_file(".ONE-PUBLISH-STATE"));
}

#[test]
fn empty_stem_snapshot_names_still_match() {
    // 前缀与扩展成立即视为自产——空干名不豁免（命名由导出侧生成，
    // 守卫只认形状不认内容）。
    assert!(is_one_publish_owned_file("execution-snapshot-.md"));
}
