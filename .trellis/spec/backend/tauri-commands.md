# Tauri Command Surface

One Publish exposes backend behavior through Tauri commands, not HTTP routes.

## Where Commands Live

- Feature commands live in focused Rust modules under `src-tauri/src/commands/`.
- Store commands live in `src-tauri/src/store/commands.rs`.
- `src-tauri/src/commands/mod.rs` re-exports command functions and generated `__cmd__*` symbols.
- `src-tauri/src/lib.rs` registers the full command surface in `tauri::generate_handler![...]`.

Reference files:

- `src-tauri/src/lib.rs`
- `src-tauri/src/commands/mod.rs`
- `src-tauri/src/commands/repository/scanner.rs`
- `src-tauri/src/commands/publish/execution.rs`
- `src-tauri/src/store/commands.rs`

## Command Shape

Use the existing shape:

- Annotate exported command functions with `#[tauri::command]`.
- Return `Result<T, crate::errors::AppError>` for fallible commands.
- Start command bodies with `CommandTimer::new("module::path::function_name")`.
- Keep command boundary logic thin enough to validate/shape inputs, then delegate to domain helpers.
- Use explicit error codes through `AppError::*_with_code(...)` when the frontend distinguishes failure reasons.

Representative examples:

- `detect_repository_provider` validates path existence, directory shape, and read access before provider detection.
- `export_config` sanitizes profile parameters before writing a private JSON file.
- `execute_publish_spec` renders, preflights, reserves a session, emits logs, and returns a structured `PublishResult`.

## Frontend Wrapper Pattern

Do not call `invoke` from arbitrary components when a shared wrapper already exists.

Current wrappers:

- Store/repository/profile/updater commands: `src/lib/store/api.ts`
- Publish runtime commands: `src/features/publish/publishRuntime.ts`

Wrapper responsibilities:

- Use generated types from `src/generated/tauri-contracts.ts`.
- Convert Rust field names to frontend store shape when needed.
- Keep command names as string literals matching `#[tauri::command]` function names.
- Surface errors to hooks/components instead of swallowing them.

Tests should verify wrappers call the right command with the right payload. See `src/lib/__tests__/publishRuntime.test.ts`.

## Scenario: Dotnet Publish Profile Execution

### 1. Scope / Trigger

- Trigger: dotnet project `.pubxml` execution crosses React selection, `PublishSpec`, Tauri publish commands, MSBuild property rendering, output preflight, and history records.

### 2. Signatures

- Renderer preview: `renderProviderPublish(spec: PublishSpec): Promise<RenderedPublishCommand>`.
- Renderer execution: `executeProviderPublish(spec: PublishSpec): Promise<PublishResult>`.
- Backend commands: `render_provider_publish(spec: PublishSpec)` and `execute_provider_publish(app, spec)`.

### 3. Contracts

- Project profile execution uses `PublishSpec.provider_id = "dotnet"`.
- `PublishSpec.project_path` is the resolved project file path.
- `.pubxml` selection is represented as `PublishSpec.parameters.properties.PublishProfile = "<profileName>"`.
- Backend schema rendering turns that map entry into `-p:PublishProfile=<profileName>`.
- Command strings are display/log/history artifacts only; they are not the stored or executable source of truth.
- `delete_existing_files` is app-level cleanup behavior consumed by publish output policy, not a normal MSBuild property.
- `define` is not a supported dotnet provider parameter and must not be stored on `PublishConfigStore`. Conditional compilation constants must use `parameters.properties.DefineConstants`, which renders through the supported `-p:` MSBuild property path.
- Visual Studio-only or deployment automation profile properties are not promoted into execution parameters. Examples include `PublishProvider`, `WebPublishMethod`, `LaunchSiteAfterPublish`, `LastUsedBuildConfiguration`, `ProjectGuid`, `_TargetId`, and `PublishUrl`.

### 4. Validation & Error Matrix

- Missing repository/project path -> existing publish start blocker or repository resolution error.
- Missing project profile in tray execution -> explicit `missing project publish profile: <name>` before running.
- Invalid output path or permission issue -> backend publish output preflight blocks execution.
- Backend render failure -> surface publish render error; do not synthesize a fake command.

### 5. Good/Base/Bad Cases

- Good: `parameters.properties.PublishProfile = "FolderProfile"` renders `-p:PublishProfile=FolderProfile`.
- Base: custom dotnet config maps typed fields like `configuration`, `runtime`, and `output` to provider schema args.
- Bad: reading `.pubxml` and flattening its XML properties into execution parameters before calling `execute_provider_publish`.
- Bad: rendering `parameters.define = ["TRACE"]` as `--define TRACE`.
- Bad: copying Visual Studio deployment fields such as `WebPublishMethod=MSDeploy` into `PublishSpec.parameters.properties`.

### 6. Tests Required

- Vitest: project profile selection and tray publish produce `PublishSpec.parameters.properties.PublishProfile`.
- Rust integration: `render_provider_publish` renders `PublishProfile` as an MSBuild property.
- Rust integration: unsupported dotnet parameters such as `define` are rejected by provider rendering.
- Vitest: config builders, command import, and `.pubxml` extraction strip unsupported fixed fields while preserving supported MSBuild properties such as `PublishSingleFile` and `DefineConstants`.
- Typecheck/contracts: `pnpm typecheck` after cross-layer publish changes.

### 7. Wrong vs Correct

#### Wrong

```typescript
spec.parameters = resolvedPubxml.parameters;
```

#### Correct

```typescript
spec.parameters = {
  properties: {
    PublishProfile: profileName,
  },
};
```

## Adding A New Command

When a feature needs a new backend API:

1. Add the command to the narrowest `src-tauri/src/commands/<domain>.rs` module or store command module.
2. Re-export it in `src-tauri/src/commands/mod.rs` when it is in the commands tree.
3. Register it in `tauri::generate_handler![...]` in `src-tauri/src/lib.rs`.
4. Add or update generated contract exports if the payload type crosses the TS boundary.
5. Add a TS wrapper beside the closest existing wrapper.
6. Add targeted Rust and/or Vitest coverage.

Avoid creating parallel command names, duplicate wrappers, or ad hoc component-level `invoke` calls.
