# align radii and layouts with latest Vercel Geist design system

## Goal

Align all page border-radii, list item classes, and warning callouts with Vercel Geist specs in DESIGN.md and design.dark.md

## Requirements

1. **Layout Hierarchy (Border Radii)**:
   - Outer shell columns (SidebarPanelShell, MainContentShell) use `rounded-lg` (16px).
   - Sidebar list row buttons (RepositoryRow, PublishConfigPanel config item buttons) must be updated to `rounded-md` (12px) to match the sidebar navigation list style (e.g. settings sidebar).
   - Icon wrappers inside the list row buttons must be updated from `rounded-md` (12px) to `rounded-sm` (6px) to match nested radii scale.
   - Popover list rows (BranchPanel active branch item) must use `rounded-sm` (6px) or `rounded-md` (12px), not `rounded-lg` (16px).
2. **Inner Dialog Card Containers**:
   - Cards and containers inside dialogs (ConfigDialog profiles, QuickCreateProfileDialog template card, ProjectPublishProfileViewerDialog supplement section card) must use `rounded-md` (12px) to match the dialog container `rounded-md` (12px) boundary.
   - Nested warning/error/info boxes (ExecutionHistoryCard failure reason box, PublishRunCard status visual blocks, error boxes) must use `rounded-md` (12px) or `rounded-sm` (6px) to match the nested text well styling.
3. **Badges and Controls**:
   - Small status badges and text indicators using `rounded` (4px) should be updated to `rounded-sm` (6px) or `rounded-md` (12px) according to the Geist scale.
4. **Transition and Physics**:
   - Verify that all modified components use `transition-colors duration-150 ease-geist` and correct color mappings.
5. **No Breakages**:
   - Ensure `pnpm build:renderer` and `pnpm test run` pass.

## Acceptance Criteria

- [ ] No nested element has a larger radius than its parent container (e.g., no `rounded-lg` inside a `rounded-md` dialog/card).
- [ ] List rows in `RepositoryList` and `PublishConfigPanel` are updated to `rounded-md` (12px) with nested icon containers updated to `rounded-sm` (6px).
- [ ] BranchPanel active branch row is updated to `rounded-sm` (6px) or `rounded-md` (12px) from `rounded-lg` (16px).
- [ ] Nested cards in `ConfigDialog`, `QuickCreateProfileDialog`, `ProjectPublishProfileViewerDialog` use `rounded-md` (12px) instead of `rounded-lg` (16px).
- [ ] Callouts/warnings in `ExecutionHistoryCard` and `PublishRunCard` use `rounded-md` (12px) instead of `rounded-lg` (16px).
- [ ] All instances of standard `rounded` (4px) in components are migrated to `rounded-sm` (6px).
- [ ] The app builds successfully and passes all unit tests.

## Notes

- Keep `prd.md` focused on requirements, constraints, and acceptance criteria.
- Lightweight tasks can remain PRD-only.
- For complex tasks, add `design.md` for technical design and `implement.md` for execution planning before `task.py start`.
