# Optimize gitignore rules

## Goal

Replace the repository root `.gitignore` with rules that match the current OnePublish stack and local tooling, then correct Git tracking for files that should be either project configuration or local-only runtime state.

## What I already know

- The repository is React 18 + TypeScript + Vite, pnpm, Vitest/Playwright, Tauri 2, and Rust.
- The current root `.gitignore` incorrectly ignores `.gitignore` itself.
- The current `.codex/*` rule hides project-scoped Trellis/Codex integration files that should be trackable.
- Root-level `config.json`, `events.jsonl`, `labels/`, `statuses/`, and `views.json` are local agent workspace metadata and should be project-level ignored.
- `src-tauri/.omc/state/idle-notif-cooldown.json` and `.claude/plan/quick-create-dialog-scroll.md` are local runtime/planning state and should not remain tracked.

## Requirements

- Update root `.gitignore` only with repository-appropriate ignore rules.
- Preserve trackability for reproducible project inputs such as lockfiles, Tauri generated schemas, icons, vendor code, Trellis files, and project Codex agents/hooks/config.
- Ignore dependencies, build outputs, test outputs, caches, logs, environment files, local agent runtime state, and machine-local metadata.
- Correct Git index ownership for local-only files and project-scoped Codex files.
- Do not delete working tree files.
- Do not run package manager, build, or test commands for this task.
- Do not commit unless separately requested.

## Acceptance Criteria

- [ ] `.gitignore` no longer ignores itself.
- [ ] `.codex/agents/`, `.codex/hooks/`, `.codex/hooks.json`, and `.codex/config.toml` are no longer hidden by ignore rules.
- [ ] Local root metadata paths are ignored by project rules.
- [ ] Local-only tracked runtime files are removed from the Git index without deleting them from disk.
- [ ] `git status --porcelain --ignored` reflects a clean, intentional split between tracked project files and ignored local state.

## Out of Scope

- Deleting local runtime files.
- Running build, typecheck, tests, or package manager commands.
- Changing product code.
- Creating a commit.

## Technical Notes

- Relevant files inspected: `README.md`, `package.json`, `src-tauri/Cargo.toml`, `src-tauri/tauri.conf.json`, `.gitignore`, `src-tauri/.gitignore`, `.trellis/.gitignore`.
- Existing Git status shows `main` ahead by three commits from the earlier commit flow.
