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


## Session 2: 实现仓库添加时 provider 列表为空仍自动绑定项目文件 + UI i18n 提取重构

**Date**: 2026-06-03
**Task**: 实现仓库添加时 provider 列表为空仍自动绑定项目文件 + UI i18n 提取重构
**Branch**: `main`

### Summary

feat(repository): provider 列表为空时回退 API 查询以自动绑定项目文件。refactor(ui): 提取硬编码 i18n 字符串，EditRepositoryDialog 改用 key 驱动重挂载。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `d3394df` | (see git log) |
| `028dca2` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
