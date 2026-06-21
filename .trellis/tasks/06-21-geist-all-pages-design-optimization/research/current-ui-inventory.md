# Current UI Inventory And Design Sources

## Sources Read

- `DESIGN.md`
- `design.dark.md`
- `src/App.tsx`
- `prototype` skill:
  - `SKILL.md`
  - `UI.md`
- Trellis frontend specs:
  - `.trellis/spec/frontend/index.md`
  - `.trellis/spec/frontend/components.md`
  - `.trellis/spec/frontend/forms.md`
  - `.trellis/spec/frontend/quality.md`
  - `.trellis/spec/guides/pre-implementation-checklist.md`

## Product Shape

One Publish is a task-focused product UI. It is not a marketing site. The primary surface is a single-page workbench:

- Left repository panel.
- Middle publish configuration panel.
- Right main content panel.
- Dialogs and overlays for settings, environment checks, repository editing, publish config, import, and release/rerun workflows.

## Design Contract Summary

Geist light/dark themes define the target:

- Minimal, high-contrast product interface.
- Tokenized color scales, including P3 accent variants.
- 4px spacing scale.
- Tight radius family:
  - 6px controls,
  - 12px menus/dialogs,
  - 16px fullscreen surfaces.
- Typography tokens for headings, labels, copy, buttons, and mono content.
- State color is meaningful and paired with text/icon, not color alone.
- Focus uses a visible two-layer ring.
- Shadows are subtle; surfaces and borders carry most hierarchy.

## Relevant Current Files

App shell:

- `src/App.tsx`
- `src/components/layout/MainContentShell.tsx`
- `src/components/layout/SidebarPanelShell.tsx`
- `src/components/layout/ResizeHandle.tsx`

Panels:

- `src/components/layout/RepositoryList.tsx`
- `src/components/layout/RepositoryRow.tsx`
- `src/components/layout/BranchPanel.tsx`
- `src/components/layout/PublishConfigPanel.tsx`

Publish content:

- `src/components/layout/PublishContentSection.tsx`
- `src/components/publish/PublishRunCard.tsx`
- `src/components/publish/DiagnosticsSection.tsx`
- `src/components/publish/ExecutionHistoryCard.tsx`
- `src/components/publish/ArtifactActions.tsx`

Dialogs/forms:

- `src/components/layout/SettingsDialog.tsx`
- `src/components/environment/EnvironmentCheckDialog.tsx`
- `src/components/layout/EditRepositoryDialog.tsx`
- `src/components/publish/ConfigDialog.tsx`
- `src/components/publish/QuickCreateProfileDialog.tsx`
- `src/components/publish/CommandImportDialog.tsx`
- `src/components/publish/CommandImportResultCard.tsx`
- `src/components/publish/RerunChecklistDialog.tsx`
- `src/components/release/ReleaseChecklistDialog.tsx`

Shared primitives/tokens:

- `src/components/ui/*`
- `src/index.css`
- `tailwind.config.cjs`

## Planning Notes

- A parent/child Trellis split is recommended because a single "all pages" production diff will be hard to review and hard to roll back.
- The first implementation target should be a prototype child task. It answers the visual direction question before production changes are made.
- Production absorption should then happen by surface family, not file-by-file randomness.
