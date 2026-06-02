# Frontend Directory Structure

Use the existing project layout.

## Main Areas

- `src/components/`: reusable UI and feature components.
- `src/components/ui/`: local UI primitives.
- `src/features/`: domain-specific hooks, runtime helpers, and logic.
- `src/hooks/`: app-level composition and compatibility hooks.
- `src/stores/`: Zustand root store and slices.
- `src/lib/`: shared frontend utilities, Tauri API wrappers, normalization, and pure helpers.
- `src/generated/`: generated Tauri contracts.
- `src/i18n/`: translation files.
- `src/test/`: frontend test setup.

## Placement Rules

- Put publish-specific UI under `src/components/publish/`.
- Put layout shell UI under `src/components/layout/`.
- Put domain orchestration under `src/features/<domain>/`.
- Put app-wide reusable hooks under `src/hooks/`.
- Put backend command wrappers in `src/lib/store/api.ts` or the closest feature runtime module.

