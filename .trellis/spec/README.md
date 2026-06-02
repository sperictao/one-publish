# One Publish Trellis Specs

These specs describe the current One Publish codebase: a Tauri 2 desktop app with a React/Vite renderer and a Rust backend.

## Minimal Bootstrap For The Next Feature Task

Use this bootstrap before planning or implementing a feature:

1. Identify whether the feature touches Rust commands, React state/forms, shared contracts, or tests.
2. Read the relevant index files:
   - Backend/Tauri work: [backend/index.md](./backend/index.md)
   - Frontend/React work: [frontend/index.md](./frontend/index.md)
   - Cross-layer contracts and commands: [shared/index.md](./shared/index.md)
   - Thinking guides: [guides/index.md](./guides/index.md)
3. Search existing examples before adding a new pattern. Prefer representative files listed in the specs over generic framework advice.
4. Validate with the narrowest applicable checks:
   - Rust command behavior: `cargo test --manifest-path src-tauri/Cargo.toml`
   - Shared contract drift: `pnpm check:contracts`
   - TypeScript units/components: `pnpm test`
   - TypeScript contract/type drift: `pnpm typecheck`
   - Browser-level smoke or drag behavior: `pnpm e2e`

## Actual Architecture

- Frontend: React 18, TypeScript, Vite, Tailwind, Radix UI primitives, Zustand, Vitest, Playwright.
- Backend: Tauri 2 Rust commands under `src-tauri/src/commands/` and store commands under `src-tauri/src/store/commands.rs`.
- Boundary: renderer code calls Tauri commands through small TypeScript wrappers, mainly `src/lib/store/api.ts` and `src/features/publish/publishRuntime.ts`.
- Contracts: Rust types derive/export through `ts-rs` in `src-tauri/src/contracts.rs`, generated into `src/generated/tauri-contracts.ts`.
- Persistence: Rust store modules under `src-tauri/src/store/`.
- Security: there is no login/session authentication layer. Current checks are Tauri capabilities, command input validation, local filesystem access validation, export sanitization, and private file permissions.

## Spec Layers

### [Backend](./backend/index.md)

Rust/Tauri backend patterns:

- [Tauri Command Surface](./backend/tauri-commands.md)
- [Security and Permission Boundaries](./backend/security-permissions.md)
- [Logging](./backend/logging.md)
- [Testing](./backend/testing.md)
- [Contracts](./backend/contracts.md)

### [Frontend](./frontend/index.md)

React renderer patterns:

- [Tauri API Usage](./frontend/tauri-api.md)
- [Forms](./frontend/forms.md)
- [State Management](./frontend/state-management.md)
- [Components](./frontend/components.md)
- [Hooks](./frontend/hooks.md)
- [Quality](./frontend/quality.md)

### [Shared](./shared/index.md)

Cross-cutting rules:

- [Code Quality](./shared/code-quality.md)
- [TypeScript](./shared/typescript.md)
- [Git Conventions](./shared/git-conventions.md)
- [Tauri Setup](./shared/tauri-setup.md)

### [Guides](./guides/index.md)

Use the thinking guides when a feature crosses layers, changes shared semantics, or fixes a bug.
