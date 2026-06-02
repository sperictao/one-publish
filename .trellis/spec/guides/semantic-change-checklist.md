# Semantic Change Checklist

Use this when changing what a field, enum, provider parameter, command payload, or persisted state value means.

## What Counts As Semantic

Examples in this repo:

- Changing a `PublishSpec` field or `SpecValue` interpretation.
- Changing a provider parameter key, default, or allowed value.
- Changing repository/project binding semantics.
- Changing execution history fields or output target classification.
- Changing profile identity or ordering rules.
- Changing preflight status meanings.

## Before Implementation

Search every reader and writer:

```bash
rg "field_or_enum_name" src src-tauri tests
rg "old_value|old_key" src src-tauri tests
```

Identify:

- Rust writers.
- Rust readers/validators.
- Generated contract exports.
- TypeScript wrappers and normalization.
- Zustand slices/hooks.
- UI renderers/forms.
- Tests and e2e mocks.

## Update Order

1. Update Rust source of truth and validation.
2. Update generated contracts when the payload crosses the boundary.
3. Update TypeScript wrappers/normalizers.
4. Update store/hooks/components.
5. Update tests and e2e mock Tauri fixtures.
6. Re-run grep for old values.

## Compatibility Decision

Be explicit:

- Clean break: old values should fail clearly or be migrated.
- Backward compatibility: readers handle both formats, and writers emit only the new format.
- Migration: store migration code owns old-to-new conversion.

Do not add silent fallback behavior that hides bad data.

## Verification

- Contract changes: `pnpm check:contracts`
- Rust behavior: `cargo test --manifest-path src-tauri/Cargo.toml`
- Frontend behavior: targeted `pnpm test` file
- Cross-layer UI flow: `pnpm e2e` when the user workflow changes

