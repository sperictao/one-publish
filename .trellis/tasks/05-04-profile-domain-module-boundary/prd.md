# Profile Domain Module 边界收敛

## Goal

把 profile 列表、缓存、mutation、导入导出和应用逻辑收敛到清晰的 Profile Domain owner，避免 `useProfiles` 与 `ConfigDialog` 各自直接读写 store 后再靠刷新回调补偿。

## Requirements

* 明确 `useProfiles` 或新 domain hook 是 repo-scoped profile state owner。
* `ConfigDialog` 不再维护第二套 `getProfiles` / `saveProfile` / `deleteProfile` 列表与 mutation 流程。
* profile 保存、删除、导入、导出后，中栏列表、配置管理弹窗和 quick create/edit 共享一致的 repo-scoped 结果。
* 保持现有 Profile UI、dialog shell、表单结构和文案行为不变。
* 不改变 profile 存储格式，除非 owner 收敛确实需要兼容迁移。

## Acceptance Criteria

* [ ] `ConfigDialog` 不再直接绕过 profile owner 执行列表加载、保存、删除后再触发 `onProfilesChanged` 双写补偿。
* [ ] quick create/edit、配置管理弹窗、导入导出、中栏 profile list 对同一 repo 显示一致。
* [ ] `src/hooks/__tests__/useProfiles.test.ts` 和 `src/components/publish/__tests__/ConfigDialog.test.tsx` 的受影响测试通过或被等价测试替代。
* [ ] `pnpm typecheck` 通过。

## Technical Approach

* 先定义 profile domain action/state facade，优先复用 `useProfiles` 已有 cache/revision/request-id 逻辑。
* 将 `ConfigDialog` 改为接收 owner 提供的 profiles、loading、save/delete/import/export actions。
* 保留 import/export 的文件对话和确认 UI，但 mutation 完成后由同一个 owner 刷新/提交 snapshot。

## Out of Scope

* Profile UI 视觉重做。
* profile JSON 格式 redesign。
* 发布执行链或 Provider Runtime 重构。

## Technical Notes

* Parent task: `.trellis/tasks/05-04-publish-workflow-module-architecture`
* Key files:
  * `src/hooks/useProfiles.ts`
  * `src/components/publish/ConfigDialog.tsx`
  * `src/components/layout/PublishConfigPanel.tsx`
  * `src/hooks/useAppDialogsProps.ts`
  * `src/lib/store.ts`
  * `src/lib/listOrdering.ts`
