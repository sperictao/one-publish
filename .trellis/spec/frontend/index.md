# Frontend Guidelines Index

> Current frontend stack: React 18 + TypeScript + Vite + Tailwind, Radix UI primitives, Zustand, Tauri command wrappers, Vitest, Playwright.

The renderer calls Rust through Tauri `invoke` wrappers and the documented store/domain wrappers.

## Pre-Development Checklist

Before editing frontend code:

- Read [tauri-api.md](./tauri-api.md) for command wrapper boundaries.
- Read [forms.md](./forms.md) before adding or changing dialogs, publish parameter controls, or profile forms.
- Read [state-management.md](./state-management.md) when touching Zustand slices, app boot, or persisted state.
- Read [components.md](./components.md) for UI primitives and accessibility patterns.
- Read [hooks.md](./hooks.md) for hook composition and async boundary patterns.
- Read [quality.md](./quality.md) before final verification.

## Documentation Files

| File | Description | When to Read |
| --- | --- | --- |
| [tauri-api.md](./tauri-api.md) | Renderer-to-Tauri command wrappers | Any backend command call from TS |
| [forms.md](./forms.md) | Controlled dialog/form patterns | Publish/profile/config forms |
| [state-management.md](./state-management.md) | Zustand store and derived state patterns | App state, preferences, repositories, publish state |
| [components.md](./components.md) | UI primitives, accessibility, toasts | Reusable UI/component work |
| [hooks.md](./hooks.md) | Custom hook organization and async effects | Feature hooks and composition hooks |
| [quality.md](./quality.md) | Test and verification expectations | Before reporting completion |

## Current Patterns

| Concern | Current Pattern | Evidence |
| --- | --- | --- |
| Tauri calls | Central wrappers call `invoke` and use generated contracts | `src/lib/store/api.ts`, `src/features/publish/publishRuntime.ts` |
| App state | Zustand root store composed from slices; hooks expose compatibility wrappers | `src/stores/appStore.ts`, `src/hooks/useAppState.ts` |
| Forms | Controlled inputs/selects/switches; parent owns draft state; save handlers validate and toast failures | `src/components/publish/QuickCreateProfileDialog.tsx`, `src/components/publish/ConfigDialog.tsx` |
| UI primitives | Components import local primitives from `src/components/ui/` and icons from `lucide-react` | `src/components/ui/`, `src/components/publish/StringParameter.tsx` |
| Tests | Vitest + Testing Library for components/hooks; Playwright for e2e | `src/components/publish/__tests__/`, `src/hooks/__tests__/`, `tests/e2e/specs/` |

## Do Not Use Unsupported Runtime Patterns

- Do not assume a query-cache library; current data flow uses wrappers, Zustand, local hooks, and explicit async calls.
- Do not call Tauri commands directly from deeply nested components when a domain wrapper belongs in `src/lib/store/api.ts` or `src/features/*`.
