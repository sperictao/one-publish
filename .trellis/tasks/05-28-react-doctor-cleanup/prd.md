# react doctor cleanup

## Goal

Improve the React Doctor health of one-publish without turning a diagnostic cleanup into an unbounded UI rewrite. The task should reduce high-confidence warnings, preserve current behavior, and leave ambiguous state/effect architecture findings for deliberate follow-up unless they can be fixed with a small, locally proven refactor.

## What I Already Know

* React Doctor reports score `69/100` with `358` warnings and no reported errors.
* The largest rule count is `design-no-redundant-size-axes` with `189` findings; this is mostly mechanical Tailwind `w-* h-*` to `size-*`.
* The next largest group is state/effect guidance:
  * `no-adjust-state-on-prop-change`: `36`
  * `exhaustive-deps`: `17`
  * `no-derived-state`: `16`
  * `no-cascading-set-state`: `11`
* Highest-density files from the trace:
  * `src/components/layout/EditRepositoryDialog.tsx`: `52`
  * `src/components/environment/EnvironmentCheckDialog.tsx`: `31`
  * `src/components/layout/PublishConfigPanel.tsx`: `24`
  * `src/components/layout/SettingsDialog.tsx`: `21`
  * `src/components/publish/DotnetPublishConfigFormSections.tsx`: `20`
  * `src/components/release/ReleaseChecklistDialog.tsx`: `18`
* The full trace lives at `/var/folders/0j/lwdmgjd16v13sw2w6cb774qr0000gn/T/react-doctor-7a1ebdf4-a5a9-4b84-b1f4-0a1fc8f9ff86`.
* Existing uncommitted changes before code edits include `package.json`, `pnpm-lock.yaml`, `.agents/skills/react-doctor/`, and `.claude/skills/react-doctor/`; this task must not accidentally overwrite or mix unrelated user changes.

## Assumptions

* React Doctor findings are hypotheses, not commands; each non-mechanical change needs a local code read before editing.
* The safest first pass is to separate mechanical style fixes from state/effect refactors.
* No commits or pushes should happen without explicit confirmation.

## Open Questions

* Scope selected: Option A, focused high-confidence pass.

## Requirements

* Read the affected code before changing non-mechanical findings.
* Preserve existing UI behavior, state transitions, and Tauri command contracts.
* Prefer small, local fixes over broad component rewrites.
* Avoid suppressing React Doctor rules unless there is code-level evidence that the warning is a false positive.
* Keep unrelated dirty files separate from this task's code changes.

## Candidate Scopes

### Option A: Focused High-Confidence Pass

Fix mechanical Tailwind class warnings, simple dependency cleanup, length-check/iteration micro-fixes, and a small number of obvious state/effect findings where the owner and behavior are clear. Leave giant-component and larger state architecture work for follow-up.

This is the selected scope for this task.

### Option B: Full Cleanup Sweep

Attempt to drive down all `358` warnings in one task, including large state/effect refactors and component extraction. This has the biggest score upside but the highest regression and review risk.

### Option C: Mechanical Only

Fix only Tailwind class shorthand, flex gap replacements, and package-manager hardening. This is lowest risk and fastest, but leaves most correctness/state warnings untouched.

## Acceptance Criteria

* [x] React Doctor warning count decreases from the current `358` baseline.
* [x] `pnpm typecheck` passes.
* [x] `npx react-doctor@latest --verbose --diff` runs after changes and shows no new regressions in touched files.
* [x] Any skipped warning class is explicitly documented in the final summary with the reason.

## Result

* Final React Doctor diff: `88/100`, `76` issues.
* Final diagnostics path: `/var/folders/0j/lwdmgjd16v13sw2w6cb774qr0000gn/T/react-doctor-8806c441-6d75-4e0b-b80e-8b6e00e9a87d`.
* Validation passed:
  * `pnpm typecheck`
  * `pnpm test -- "src/components/layout/__tests__/PublishConfigPanel.test.tsx"`
  * Earlier focused sweep also passed `51` test files / `219` tests.
* Remaining warnings are intentionally left out of this A-scope pass because they require broader state-owner or component-boundary decisions.

## Definition of Done

* Tests/checks relevant to touched areas pass.
* TypeScript remains strict without `any`-based shortcuts.
* No unrelated user changes are reverted.
* No commit is created unless the user explicitly confirms the commit plan.

## Out of Scope

* Rewriting large dialogs solely to satisfy `no-giant-component`.
* Changing user-visible workflow behavior without a dedicated product requirement.
* Rust/Tauri backend changes unless a React warning exposes a concrete cross-layer bug.

## Technical Notes

* `package.json` already has a `doctor` script invoking `npx react-doctor@latest`.
* Local `react-doctor` skill says to run full verbose scans for general cleanup and `--diff` after React code changes.
* React Doctor trace files are split by rule and can be used to plan batches.
