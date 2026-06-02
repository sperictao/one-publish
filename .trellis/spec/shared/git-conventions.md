# Git Conventions

Use conventional commit style when preparing commits.

## Commit Message Format

```text
type(scope): description
```

Common types:

| Type | Description |
| --- | --- |
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `refactor` | Code change that neither fixes a bug nor adds a feature |
| `test` | Adding or updating tests |
| `chore` | Build, dependencies, release, or tooling |
| `style` | Formatting-only changes |
| `perf` | Performance improvement |

Common scopes for this repo:

| Scope | Description |
| --- | --- |
| `tauri` | Tauri app setup/plugins/capabilities |
| `commands` | Rust Tauri command surface |
| `contracts` | Generated Rust-to-TS contracts |
| `publish` | Publish flow, preflight, execution |
| `provider` | Provider registry/schemas/runtime |
| `store` | Rust store or Zustand state |
| `ui` | React components/layout |
| `settings` | Preferences/settings dialog |
| `release` | Release/updater scripts |
| `trellis` | Trellis docs/spec/workflow |

Examples:

```bash
feat(publish): add mounted output preflight summary
fix(commands): register repository branch connectivity command
docs(trellis): refresh Tauri spec bootstrap
test(contracts): cover generated contract drift
chore(release): update updater asset validation
```

## Branch Naming

```text
type/description
```

Examples:

```bash
feat/publish-preflight-summary
fix/tauri-command-registration
docs/trellis-tauri-specs
```

## Before Committing

- Run the checks that match the changed files.
- Keep commits atomic.
- Do not include unrelated workspace changes.
- Use a scope that reflects the code actually touched.

