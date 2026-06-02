# Thinking Guides For One Publish

These guides are for the current Tauri + React codebase.

## Available Guides

| Guide | Purpose | When to Use |
| --- | --- | --- |
| [Pre-Implementation Checklist](./pre-implementation-checklist.md) | Search and boundary checks before coding | Before any feature or bug fix |
| [Cross-Layer Thinking](./cross-layer-thinking-guide.md) | Data flow across React, wrappers, Rust commands, store, and contracts | Features touching multiple layers |
| [Code Reuse Thinking](./code-reuse-thinking-guide.md) | Avoid duplicate wrappers, helpers, and UI patterns | When adding utilities or repeated logic |
| [Semantic Change Checklist](./semantic-change-checklist.md) | Update every reader/writer when a field meaning changes | Provider/spec/store/publish semantics |
| [Bug Root Cause Analysis](./bug-root-cause-thinking-guide.md) | Classify and prevent repeated bugs | After non-trivial fixes |

## Quick Routing

- Tauri command or payload change: read cross-layer and semantic-change.
- New form/dialog/component: read pre-implementation and frontend/forms.
- New wrapper/helper/hook: read code-reuse first.
- Permission, filesystem, publish output, or process execution: read backend/security-permissions and big-question/publish-output-preflight.
- Generated contract change: read backend/contracts and big-question/tauri-contract-drift.

## Core Rule

Search before writing. For this repo, the likely source of truth is one of:

- Rust command/store modules under `src-tauri/src/`
- Generated contracts under `src/generated/tauri-contracts.ts`
- Tauri wrappers under `src/lib/store/api.ts` and `src/features/publish/publishRuntime.ts`
- Zustand slices under `src/stores/`
- UI primitives under `src/components/ui/`

