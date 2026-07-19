# OnePublish Design Philosophy

OnePublish is a cross-platform desktop GUI for publishing multi-language projects (.NET, Rust, Go, Java/Gradle).

This document explains the current design philosophy from two perspectives:

- Product-facing: how the tool should feel and why it exists
- Developer-facing: architectural boundaries and how to extend it safely

## Product Philosophy (User-Facing)

### Positioning

OnePublish is an engineering tool designed to make publishing software projects:

- Repeatable (same inputs -> same outputs)
- Visible (you can see what is happening and why)
- Fast for daily use (keyboard-first, minimal friction)

It aims to remove common failure modes of copy-pasting commands, forgetting flags, and misplacing artifacts.

### Publish Is A Workflow, Not A Command

Publish commands (`dotnet publish`, `cargo build --release`, `go build`, Gradle tasks) are treated as workflows users run repeatedly.

Design consequences:

- Key actions are always close: select project, refresh, publish.
- Publishing has an explicit execution surface (button + keyboard shortcut).
- Output is treated as a first-class artifact (default output directory preference).

### Efficiency For High-Frequency Users

OnePublish assumes you publish often.

Design consequences:

- Global shortcuts exist for core actions.
- The UI is optimized for quick re-runs.
- Settings focus on high-leverage preferences instead of endless knobs.

### Progressive Enhancement (Ship The Shape, Then Deepen It)

Some features start as UI + state management first, and later become fully wired.

Example:

- Updater: UI surface and states exist, then the actual update source/pipeline can be integrated (e.g. GitHub Releases + signing).

The goal is to keep the product moving without being blocked by infrastructure work.

### Clarity Over Cleverness

When publishing fails, the tool should be explicit.

Design consequences:

- Runtime state is surfaced (checking/installing update, logs, etc.).
- Actions are explicit; users should not have to guess hidden behavior.

### Local-First By Default

Publishing happens locally and should remain useful offline.

External services (like update sources) are optional integrations rather than a dependency for core usage.

### Accessible, Consistent UI

UI is built from accessible primitives (Radix/shadcn) and consistent patterns.

Design consequences:

- Dialog/select/switch behaviors are predictable.
- Design favors structure and clarity over novelty.

## Engineering Philosophy (Developer-Facing)

### Separation Of Concerns

- Frontend (React): state, user intent, rendering, client-side preferences.
- Backend (Tauri/Rust): OS-level capabilities, filesystem/process integration, global shortcuts, tray.

This boundary keeps the UI fast to iterate and the system behavior correct and testable.

### Commands + Events As The Contract

The contract between frontend and backend should be:

- Tauri commands: for request/response actions (e.g. run publish, scan projects).
- Events: for asynchronous signals (e.g. global shortcut triggers, long-running process output).

Rule of thumb:

- If the user clicked something and expects a result: command.
- If something happens in the background: event.

### Configuration And Preferences

Preferences are treated as stable inputs to the workflow.

Guidelines:

- Keep settings minimal and high-leverage.
- Prefer backward compatible changes (migrations if needed).
- Defaults should be sensible for most repos.

### Internationalization As Structure

Translations are structured by feature domain (nested JSON).

Guidelines:

- Keys should map to UI structure (e.g. `settings.title`, `version.check`).
- The translation function should support dot-path resolution.
- Avoid mixing formatting styles; prefer a single placeholder convention.

### Cross-Platform Parity, With Platform Respect

Goal:

- Same conceptual features across OSes.

But:

- Use platform-appropriate modifiers and behaviors (Cmd on macOS, Ctrl elsewhere).

### Observability Is A Feature

Process execution should be observable:

- Stream stdout/stderr into the UI
- Keep logs structured enough to debug
- Avoid swallowing errors

### Testability Strategy (Pragmatic)

Current layers, enforced in CI (`.github/workflows/quality.yml`):

- Typecheck (TS strict) plus `ts-rs` contract validation are mandatory.
- Unit tests for pure logic: Vitest on the frontend, `#[cfg(test)]` on the Rust backend.
- Playwright e2e specs cover the core desktop flows (boot, repo panel, providers, presets, preflight, publish flow).

## Non-Goals (For Now)

To keep the tool focused, the following are intentionally de-prioritized:

- A large plugin system
- Complex cloud sync
- Infinite matrix of publish options exposed in UI

The philosophy is: cover the 80% workflow extremely well, then add depth selectively.
