# dotnet publish config execution implementation

## Checklist

- Inspect current publish config, preview, execution, pubxml selection, history rerun, and command import paths.
- Add focused tests that prove the approved invariants, especially `.pubxml` -> `properties.PublishProfile` -> backend-rendered `-p:PublishProfile=<name>`.
- Remove unsupported dotnet fields from the execution-producing model: stop emitting `define`, remove Visual Studio-only fixed fields from advanced UI, and filter known unsupported `.pubxml` properties before `PublishSpec` generation.
- Make the smallest production changes needed to pass those tests.
- Re-run searches for direct command-string execution or duplicate dotnet parameter rendering in publish execution paths.

## Validation

- Targeted Vitest for dotnet config adapter/runtime/hook behavior.
- Targeted Rust publish/provider tests when backend rendering behavior changes or needs regression coverage.
- Targeted tests for unsupported field stripping in config mapping, command import, advanced field modeling, `.pubxml` parsing/copying, and backend render rejection.
- `pnpm typecheck` for frontend/type/contract validation.
- `git diff --check`.
- `npx react-doctor@latest --verbose --diff` before finishing React changes.

## Risk Points

- Do not hand-edit generated Tauri contracts unless a Rust payload change requires regeneration.
- Do not add direct component-level `invoke` calls.
- Do not move output preflight rules into React.
- Do not treat `.pubxml` fields as fully supported CLI behavior; execution support stays bounded to `dotnet publish` + MSBuild properties.
