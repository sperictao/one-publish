# Code Reuse Thinking Guide

Use this before adding helpers, wrappers, hooks, or repeated UI patterns.

## Search Before Creating

```bash
rg "helper_name|similar_keyword" src src-tauri
rg "type SimilarType|interface SimilarType" src
rg "fn similar_name|struct SimilarName" src-tauri/src
```

## Current Reuse Locations

| Need | Prefer |
| --- | --- |
| Tauri command wrapper | `src/lib/store/api.ts` or `src/features/<domain>/*Runtime.ts` |
| Invoke error parsing | `src/lib/tauri/invokeErrors.ts` |
| Frontend store type normalization | `src/lib/store/types.ts` |
| Publish config transforms | `src/features/config/` and `src/features/publish/` |
| UI primitives | `src/components/ui/` |
| App dialogs/sections | `AppDialogShell`, `AppDialogInset`, `SectionShell` |
| Rust command helper | Nearby `src-tauri/src/commands/<domain>/` module |
| Rust security/export helper | `src-tauri/src/security.rs` |
| Rust provider/spec logic | `src-tauri/src/provider/`, `src-tauri/src/spec.rs`, `src-tauri/src/parameter.rs` |

## Extraction Threshold

- One use: keep local.
- Two uses: consider whether the concept is stable.
- Three or more uses: extract to the owning module.

Prefer extracting to the feature that owns the concept, not to a generic utility folder.

## Red Flags

- A component imports `invoke` directly for a command family that already has wrappers.
- A frontend file hand-defines a payload already present in generated contracts.
- A Rust command repeats path validation or sanitization logic already in `security.rs` or publish preflight.
- A dialog copies shell/section markup instead of reusing local primitives.
- A hook repeats store restore/error behavior already covered by store helpers.

## After A Batch Change

Search again for the old pattern or value. If you intentionally leave another instance alone, mention why in the task notes or final summary.

