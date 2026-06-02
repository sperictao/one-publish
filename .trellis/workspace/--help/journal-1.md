# Journal - --help (Part 1)

> AI development session journal
> Started: 2026-06-02

---



## Session 1: 修复 profile 选中身份跨仓库切换持久化

**Date**: 2026-06-02
**Task**: 修复 profile 选中身份跨仓库切换持久化
**Branch**: `main`

### Summary

将 activeProfileName 从本地 state 重构为由 selectedPreset 的 userprofile:* key 派生，确保仓库切换后自动恢复自定义 profile 选中状态。同步修改 useProfileCrud 在创建/应用时写入 setSelectedPreset，更新规范文档，新增跨仓库切换恢复与普通自定义不自带旧选择的测试用例。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `fe9326b` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
