# Backend Testing

Backend tests are Rust tests. Use the smallest test level that exercises the behavior.

## Unit Tests Beside Modules

Keep pure logic tests inside the Rust module with `#[cfg(test)]` when the behavior does not need the Tauri runtime.

Examples:

- `src-tauri/src/errors.rs` tests error mapping.
- `src-tauri/src/security.rs` tests sanitization.
- `src-tauri/src/store/tests.rs` tests store migration and recent-state cleanup.
- `src-tauri/src/commands/publish/preflight/mod.rs` tests output target validation/access logic.

## Integration Tests

Use `src-tauri/tests/` for public API roundtrips and filesystem-backed behavior.

Examples:

- `src-tauri/tests/publish_roundtrip.rs` verifies `PublishSpec -> render_provider_publish -> preflight_publish_output`.
- `src-tauri/tests/preflight_access.rs` verifies output access validation.
- `src-tauri/tests/provider_and_spec.rs` covers provider/spec behavior.

Use `tempfile` for filesystem state rather than relying on developer machine paths.

## Validation Commands

- Rust backend: `cargo test --manifest-path src-tauri/Cargo.toml`
- Specific Rust integration test: `cargo test --manifest-path src-tauri/Cargo.toml --test publish_roundtrip`
- Contract drift: `pnpm check:contracts`

Run targeted Rust tests before broader checks when only backend behavior changed.

