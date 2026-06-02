# Shared Guidelines

> Shared rules for the current One Publish Tauri + React repository.

## Pre-Development Checklist

- Read [code-quality.md](./code-quality.md) before touching app code.
- Read [typescript.md](./typescript.md) for TypeScript conventions.
- Read [tauri-setup.md](./tauri-setup.md) when changing scripts, build setup, generated contracts, or Tauri packaging assumptions.
- Read [git-conventions.md](./git-conventions.md) only when preparing commits or branches.

## Documentation Files

| File | Description | When to Read |
| --- | --- | --- |
| [code-quality.md](./code-quality.md) | Shared quality and validation expectations | Always |
| [typescript.md](./typescript.md) | TypeScript and generated contract usage | Type-related decisions |
| [tauri-setup.md](./tauri-setup.md) | Existing Tauri/pnpm scripts and build checks | Tooling, packaging, contract generation |
| [git-conventions.md](./git-conventions.md) | Commit and branch conventions | Before committing |

## Core Rules

- Treat Rust generated contracts as the source for Tauri payload types.
- Keep frontend command calls behind wrappers.
- Validate filesystem/process-sensitive inputs in Rust commands, not only in the renderer.
- Run targeted tests before broad checks.
- Do not use guidance for technologies that are not present in the current codebase.
