# Design - Geist Radii and Layout Alignment

This document outlines the technical design for aligning all page border-radii, list item classes, and warning callouts with the Geist design system specifications in `DESIGN.md` and `design.dark.md`.

## Radius Nesting Philosophy

To maintain a clean and professional look, we enforce a strict hierarchical nesting rule for border-radii:
```
[Parent Container] -> [Nested Row/Card] -> [Inner Control/Icon]
  rounded-lg (16px)  -> rounded-md (12px) -> rounded-sm (6px)
```
Specifically, we apply the following mappings:
1. **Outermost Layout Shells**: `rounded-lg` (16px) (e.g., `MainContentShell`, `SidebarPanelShell`).
2. **Dialogs and Major Sections**: `rounded-md` (12px) (e.g., `AppDialogShell` surface, dropdown menus, major inline cards/sections).
3. **List Rows and Inner Cards**: `rounded-md` (12px) (e.g., `RepositoryRow` buttons, `PublishConfigPanel` row buttons, profile cards in dialogs).
4. **Everyday Inputs, Buttons, and Inner Icons**: `rounded-sm` (6px) (e.g., inputs, standard buttons, small icon containers nested in rows).
5. **Pills and Badges**: `rounded-full` (9999px).
6. **No standard `rounded` (4px)**: All legacy 4px `rounded` classes must be replaced with `rounded-sm` (6px) to match the Geist token specs.

## Component Mappings

### 1. Sidebar Rows
- **`RepositoryRow`**:
  - Main button container: Change `rounded-lg` (16px) to `rounded-md` (12px) (since it resides in `SidebarPanelShell` which is `rounded-lg`).
  - Nested icon container (`FolderGit2` wrapper): Change `rounded-md` (12px) to `rounded-sm` (6px).
- **`PublishConfigPanel`**:
  - Main item buttons: Change `rounded-lg` (16px) to `rounded-md` (12px).
  - Nested icon container (`FileText` wrapper): Change `rounded-md` (12px) to `rounded-sm` (6px).

### 2. Inner Dialog Cards
- **`ConfigDialog`**:
  - Profile item card: Change `rounded-lg` (16px) to `rounded-md` (12px) (resides in `AppDialogShell` which is `rounded-md`).
- **`QuickCreateProfileDialog`**:
  - Template card: Change `rounded-lg` (16px) to `rounded-md` (12px).
  - Header icon container: Change `rounded-lg` (16px) to `rounded-sm` (6px) or `rounded-md` (12px).
- **`ProjectPublishProfileViewerDialog`**:
  - Supplement section card: Change `rounded-lg` (16px) to `rounded-md` (12px).

### 3. Nested Callouts and Text Wells
- **`ExecutionHistoryCard`**:
  - Failure reason box: Change `rounded-lg` (16px) to `rounded-md` (12px).
- **`PublishRunCard`**:
  - Status box (`output` element): Change `rounded-lg` (16px) to `rounded-md` (12px).
  - Status icon wrapper: Change `rounded-lg` (16px) to `rounded-sm` (6px).
  - Error/Failure reason box: Change `rounded-lg` (16px) to `rounded-md` (12px).
  - Output directory button: Change `rounded-lg` (16px) to `rounded-md` (12px), and its nested icon wrapper to `rounded-sm` (6px).
  - Log terminal well: Change `rounded-lg` (16px) to `rounded-md` (12px).

### 4. Legacy `rounded` (4px) cleanups
- **`BranchPanel`**:
  - Active branch item: Change `rounded-lg` (16px) to `rounded-sm` (6px) or `rounded-md` (12px).
  - Status badge: Change `rounded` (4px) to `rounded-sm` (6px).
- **`CollapsiblePanel`**:
  - PanelToggleButton: Change `rounded` (4px) to `rounded-sm` (6px).
- **`EnvironmentCheckDialog`**:
  - Path/version code badges (lines 426, 430): Change `rounded` (4px) to `rounded-sm` (6px).
