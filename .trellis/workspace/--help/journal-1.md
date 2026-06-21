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


## Session 3: Geist token 体系重构与全页面组件迁移

**Date**: 2026-06-21
**Task**: Geist token 体系重构与全页面组件迁移
**Branch**: `main`

### Summary

重构 Geist 设计 token 体系为 step token + 语义别名双层结构（sRGB HSL 回退叠加 P3 oklch），并在 tailwind-merge 注册 typography class group 防止 color 工具类被误剥离。将 ui/layout/publish/release/environment 全量组件迁移到 step token 与 heading/button/label/copy typography 工具类，按钮引入 focus-ring 共享类、Input 新增 bare 模式。新增 dev-only Geist 工作台原型路由（?variant=A），并补充 e2e 用例。归档 06-21 三个 Geist 任务。注意：typecheck/react-doctor/browser smoke 验证未执行，留待后续。

### Main Changes

(Add details)

### Git Commits

| Hash | Message |
|------|---------|
| `1e49e9b` | (see git log) |
| `9f59dfb` | (see git log) |
| `401ac85` | (see git log) |
| `cd1da79` | (see git log) |

### Testing

- [OK] (Add test results)

### Status

[OK] **Completed**

### Next Steps

- None - task complete
