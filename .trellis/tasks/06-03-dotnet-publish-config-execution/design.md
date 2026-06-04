# dotnet publish config execution design

## Architecture

The execution source of truth remains `PublishSpec`:

React publish config/editor state -> `buildProviderPublishSpec` -> `render_provider_publish` for preview -> `execute_provider_publish` for execution.

The renderer must not execute command strings directly. Backend publish execution owns command rendering, output preflight, cleanup policy, process spawning, streamed logs, and structured `PublishResult`.

## Dotnet Parameter Mapping

Custom dotnet settings map to provider parameters:

- `configuration` -> `--configuration`
- `runtime` -> `--runtime`
- `framework` -> `--framework`
- `output` -> `--output`
- `self_contained` -> `--self-contained`
- `no_build` -> `--no-build`
- `no_restore` -> `--no-restore`
- `verbosity` -> `--verbosity`
- `no_logo` -> `--no-logo`
- `properties` -> `-p:Key=Value`

`delete_existing_files` remains app-level behavior consumed by publish output policy.

`define` is not a supported `dotnet publish` option and is not part of OnePublish's dotnet publish configuration model. Do not keep a legacy compatibility field for it. Use `properties.DefineConstants` when conditional compilation constants need to be passed through the supported MSBuild property path.

The fixed advanced field list must not promote Visual Studio-only or deployment automation properties. Known unsupported property keys are filtered before writing execution parameters: `Configuration`, `Define`, `ExcludeApp_Data`, `LastUsedBuildConfiguration`, `LastUsedPlatform`, `LaunchSiteAfterPublish`, `Platform`, `ProjectGuid`, `PublishProvider`, `PublishUrl`, `RuntimeIdentifier`, `RuntimeIdentifiers`, `SiteUrlToLaunchAfterPublish`, `TargetFramework`, `TargetFrameworks`, `WebPublishMethod`, and `_TargetId`.

Common publish MSBuild properties such as `PublishProfile`, `PublishSingleFile`, `PublishTrimmed`, `DefineConstants`, and `Version` remain valid under the generic `properties` map because `dotnet publish` supports `-p:Key=Value`.

## Pubxml Handling

Project publish profile selection produces a dotnet config with `use_profile = true` and `profile_name = <name>`. The adapter writes this to `parameters.properties.PublishProfile`. Backend schema rendering turns map entries into `-p:PublishProfile=<name>`.

OnePublish does not flatten `.pubxml` content into individual command-line flags for execution.

## Compatibility

No persisted schema change is intended. Existing history records and profiles that already contain `properties.PublishProfile` continue to work. If implementation finds direct command-string execution in production paths, replace it with existing `PublishSpec` runtime calls rather than adding a parallel parser.
