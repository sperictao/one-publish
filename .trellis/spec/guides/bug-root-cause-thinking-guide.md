# Bug Root Cause Thinking Guide

Use this after a non-trivial bug fix or when a fix attempt did not hold.

## Classify The Root Cause

| Category | Questions | Common Fix |
| --- | --- | --- |
| Command registration | Did Rust command, module export, handler registration, and TS wrapper all change together? | Update the full registration chain and add wrapper/Rust tests |
| Contract drift | Did Rust payload shape change without regenerated TS contracts? | Regenerate contracts and update wrapper normalization |
| Boundary validation | Did React assume a filesystem/process/publish operation was valid? | Move authoritative validation to Rust and surface structured errors |
| State synchronization | Did local Zustand/UI state diverge from backend state? | Restore authoritative state or update the owning slice |
| React timing | Did code read state immediately after setting it, or store a function incorrectly? | Use returned values, refs, or wrapped function setters |
| Reuse mismatch | Was a helper used for a responsibility it does not actually own? | Create or use the precise helper and document the invariant |

## Debug Loop

1. Reproduce the failing behavior or test.
2. Trace the data from UI to wrapper to Rust command and back.
3. Identify the first layer where the value becomes wrong.
4. Fix the invariant at that layer, not only the symptom downstream.
5. Add the narrowest regression test.

## Evidence To Collect

- Command name and payload from the wrapper.
- Rust command or helper that receives the payload.
- Generated contract type if the payload crosses layers.
- Error code/details from `AppError` or invoke error helpers.
- Store slice or hook that consumes the result.

## When To Update Specs

Update `.trellis/spec/` when the bug teaches a reusable project rule, especially around:

- Tauri command registration.
- Generated contract drift.
- Publish output preflight.
- Security/sanitization.
- Zustand authoritative state restoration.

