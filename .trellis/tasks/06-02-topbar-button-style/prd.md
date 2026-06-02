# topbar button style unification

## Goal

Unify the visual style of the main window's top 40px titlebar buttons so the left, middle, and right panel controls match the existing glass / repo shell design.

## Requirements

- Only update the top titlebar buttons:
  - Left panel collapse button.
  - Middle panel expand/collapse buttons.
  - Right panel expand buttons and home/history view buttons.
- Keep the second-row list action buttons unchanged.
- Preserve existing behavior, callbacks, drag regions, `data-tauri-no-drag`, titles, aria labels, and pressed states.
- Reuse existing glass tokens and Tailwind classes; do not introduce a new visual system.
- Do not touch floating list cards, drag behavior, state ownership, or persistence.

## Acceptance Criteria

- [ ] Topbar icon buttons share the same base pill shape, hover/focus/active behavior, and muted-to-foreground color treatment.
- [ ] The selected right-panel view button uses a glass selected state instead of the current bright solid background.
- [ ] Left, middle, and right titlebar controls remain clickable in Tauri drag regions.
- [ ] `pnpm typecheck` passes.

## Out of Scope

- Changing second-row filter, add, sort, refresh, or config-management buttons.
- Changing business logic, panel state, list ordering, floating cards, or app copy.

## Technical Notes

- Relevant components: `RepositoryList`, `PublishConfigPanel`, and `MainContentShell`.
- Relevant specs: frontend component and quality guidelines; shared code reuse guide.
