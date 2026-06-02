# Pre-Implementation Checklist

Use this before writing code for a feature or bug fix.

## Search First

Run targeted searches before creating new code:

```bash
rg "command_or_field_name" src src-tauri
rg "similarConcept|similar_helper" src src-tauri
rg "invoke\\(\"command_name\"" src
```

## Constants And Configuration

- Will the value be used by both Rust and TypeScript?
  - Prefer generated contracts or an existing shared config path.
- Will the value be used by multiple frontend files?
  - Put it near the owning feature or shared UI/helper module.
- Will the value be used by multiple Rust modules?
  - Put it in the narrowest Rust module that owns the concept.
- Is it only for one component/function?
  - Keep it local.

## Types And Contracts

- Does this type cross the Tauri boundary?
  - Add/export it through Rust contracts and regenerate `src/generated/tauri-contracts.ts`.
- Is there already a frontend normalized type?
  - Check `src/lib/store/types.ts`.
- Is this a publish/provider parameter?
  - Check `src/types/parameters.ts`, provider schemas, and generated contracts.

## Tauri Commands

Before adding a command:

- Check whether an existing command can be reused.
- Choose the narrowest Rust module.
- Plan registration in `src-tauri/src/commands/mod.rs` and `src-tauri/src/lib.rs`.
- Plan a TS wrapper in `src/lib/store/api.ts` or a feature runtime module.
- Plan tests for Rust behavior and wrapper command names.

## Frontend UI

Before creating a component or form:

- Check `src/components/ui/` for primitives.
- Check existing publish/layout dialogs for shell and section patterns.
- Keep fields controlled.
- Use labels/roles that Testing Library can query.
- Do not add a form library unless the repo already adopts one.

## Permission And Filesystem Work

For filesystem/process/publish output features:

- Read backend/security-permissions.
- Check whether Tauri capabilities need a narrow update.
- Keep validation in Rust commands.
- Add preflight or sanitization coverage when changing output/export behavior.

