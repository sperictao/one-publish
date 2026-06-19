# Implementation Plan - Geist Radii and Layout Alignment

This document outlines the ordered implementation steps, validation commands, and rollback points for aligning all page border-radii, list items, and warning callouts with Vercel Geist design system specifications.

## Step-by-Step Implementation

### Phase 1: Modify Components

- [ ] **1.1 Layout Sidebar Rows**
  - Update `src/components/layout/RepositoryRow.tsx`:
    - Row button: Change `rounded-lg` to `rounded-md`.
    - Inner icon wrapper: Change `rounded-md` to `rounded-sm`.
  - Update `src/components/layout/PublishConfigPanel.tsx`:
    - Row buttons (all matches): Change `rounded-lg` to `rounded-md`.
    - Inner icon wrappers (all matches): Change `rounded-md` to `rounded-sm`.

- [ ] **1.2 Inner Dialog Cards**
  - Update `src/components/publish/ConfigDialog.tsx`:
    - Profile card: Change `rounded-lg` to `rounded-md`.
  - Update `src/components/publish/QuickCreateProfileDialog.tsx`:
    - Template card: Change `rounded-lg` to `rounded-md`.
    - Header icon container: Change `rounded-lg` to `rounded-sm` or `rounded-md`.
  - Update `src/components/publish/ProjectPublishProfileViewerDialog.tsx`:
    - Supplement section card: Change `rounded-lg` to `rounded-md`.
  - Update `src/components/publish/ReadonlyParameterFieldsSection.tsx`:
    - Card: Change `rounded-lg` to `rounded-sm` or `rounded-md`.

- [ ] **1.3 Callouts and Log Terminal**
  - Update `src/components/publish/ExecutionHistoryCard.tsx`:
    - Failure reason callout: Change `rounded-lg` to `rounded-md`.
  - Update `src/components/publish/PublishRunCard.tsx`:
    - Status box output: Change `rounded-lg` to `rounded-md`.
    - Status icon wrapper: Change `rounded-lg` to `rounded-sm`.
    - Error visual box: Change `rounded-lg` to `rounded-md`.
    - Output directory button: Change `rounded-lg` to `rounded-md`.
    - Output directory icon wrapper: Change `rounded-lg` to `rounded-sm`.
    - Log terminal container: Change `rounded-lg` to `rounded-md`.

- [ ] **1.4 Legacy `rounded` (4px) Cleanups**
  - Update `src/components/layout/BranchPanel.tsx`:
    - Active branch item row (line 228): Change `rounded-lg` to `rounded-md` (or `rounded-sm` if it fits better).
    - Status badge (line 243): Change `rounded` to `rounded-sm`.
  - Update `src/components/layout/CollapsiblePanel.tsx`:
    - PanelToggleButton (line 74): Change `rounded` to `rounded-sm`.
  - Update `src/components/environment/EnvironmentCheckDialog.tsx`:
    - Path and version code badges (lines 426, 430): Change `rounded` to `rounded-sm`.

### Phase 2: Verification

- [ ] **2.1 Run Automated Verification**
  - Run type checker: `pnpm typecheck`
  - Run unit tests: `pnpm test run`
  - Run renderer build: `pnpm build:renderer`

- [ ] **2.2 Manual UI Verification**
  - Run dev server: `pnpm dev`
  - Inspect sidebar list rows, config items, dialog profiles, warnings, and log terminal.
  - Verify that no nested rounded corner overlaps a smaller parent corner, and that all corners look consistently tight and sharp according to Geist style.

## Rollback Plan
If any visual layout or automated tests fail and cannot be easily fixed:
```bash
git restore src/components/layout/RepositoryRow.tsx \
            src/components/layout/PublishConfigPanel.tsx \
            src/components/publish/ConfigDialog.tsx \
            src/components/publish/QuickCreateProfileDialog.tsx \
            src/components/publish/ProjectPublishProfileViewerDialog.tsx \
            src/components/publish/ReadonlyParameterFieldsSection.tsx \
            src/components/publish/ExecutionHistoryCard.tsx \
            src/components/publish/PublishRunCard.tsx \
            src/components/layout/BranchPanel.tsx \
            src/components/layout/CollapsiblePanel.tsx \
            src/components/environment/EnvironmentCheckDialog.tsx
```
