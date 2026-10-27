# one-publish-runner

Standalone execution runner for **One Publish** automation bindings. It interprets a
sealed `PublishPlan` through the built-in provider/processor/backend/store/destination
adapters and emits the standard event stream, artifact manifest, and delivery receipt —
the same runner core the desktop app uses for local execution.

Release binaries for Linux, macOS, and Windows are published as `runner-v*` tags via
`runner-release.yml` (`.tar.gz` + `.sha256`).

## Usage

```
one-publish-runner <command> <path> [arguments]
one-publish-runner --help | -h | help
```

| Command                   | Arguments                                                          | Output                                                                                               |
| ------------------------- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| `verify`                  | `<projection.json>`                                                | validates an installed automation projection (integrity + pinned runtime); prints nothing on success |
| `prepare-from-projection` | `<projection.json> <checkout-root> <tag:<tag>\|version:<version>>` | replays the deterministic planner for a trigger; prints the sealed `PreparedAttempt` as JSON         |
| `execute`                 | `<attempt.json> <attempt-id> [platform]`                           | executes a sealed attempt; prints the outcome (or shard segment) as JSON                             |

**Platform affinity** (`execute` only): `any` runs the converging segment, while
`linux` / `macos` / `windows` run a single build shard. Omitting the argument executes
the whole attempt locally.

## I/O contract

- Commands that produce evidence write a single JSON document to **stdout**.
- Diagnostics and failures go to **stderr**, prefixed with `one-publish-runner:`.
- Both sides stay machine-readable; do not log human prose to stdout.

## Trigger descriptor

`prepare-from-projection` requires exactly one trigger descriptor (decision #89):

- `tag:<full tag>` — used by tag-push automation shells
- `version:<explicit version>` — used by manual `workflow_dispatch` runs

The descriptor shape is cross-validated against the projection's `trigger_policy` at act
time.

## Shard handoff

Cross-segment handoff (decision #85) uses two directories relative to the working
directory:

- `.one-publish-work/staged` — build shards stage their candidates here for the
  converging (`any`) segment to import
- `.one-publish-work/segments` — shard event segments; the converging segment reads them
  as dependency evidence

Shard JSON files carry evidence only — no credentials, no mutable plan state.

## Credentials

The projection's `secret_bindings` map credential references to environment Secret names
(names are not secrets; ADR-0029). At the execution boundary the runner resolves each
reference from the process environment — values are never read from disk.

## Exit status & signals

| Status           | Meaning                           |
| ---------------- | --------------------------------- |
| `0`              | success                           |
| `1`              | structured failure (see stderr)   |
| `128 + <signal>` | cancelled by a termination signal |

On Unix, `SIGINT`/`SIGTERM` are converted into a cancellation request (ADR-0041): the
runner interrupts the execution port and reaps the whole build process tree, prints a
`Cancelled` outcome, then exits `128+<signal>`. A second termination signal restores the
default disposition and exits immediately — the caller asked for a force quit. On
Windows the console `Ctrl+C` reaches the build directly; no process-group isolation is
performed.
