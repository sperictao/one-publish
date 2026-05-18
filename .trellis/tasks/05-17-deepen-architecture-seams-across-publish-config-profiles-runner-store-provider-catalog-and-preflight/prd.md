# Deepen architecture seams across publish config, profiles, runner, store, provider catalog, and preflight

## Goal

Turn the six architecture review candidates into a staged refactor that makes the major workflow modules deeper: smaller public interfaces, more behavior behind each seam, and tests that verify intent instead of current incidental wiring.

## What I already know

* The user approved completing all six review points.
* The work is intentionally architectural and spans more than three files, so it must be broken into independently verifiable units.
* Current branch is `main`; worktree was clean at session start.
* `PublishConfigPanel.tsx` is the largest frontend hotspot and currently mixes data indexing, filtering, recent resolution, reorder state, viewer loading, and rendering.
* `useProfiles.ts` owns profile list state plus quick create/edit, mutation, import/export, provider apply, and toast feedback.
* `usePublishRunner.ts` is short, but the publish runner seam is still wide because validate/execute sub-hooks exchange implementation-heavy objects.
* Store mutation contracts are mixed: some frontend wrappers return `AppState`, some return `void`; optimistic state and backend responses are not expressed through one shape.
* Provider runtime metadata is backend-owned, while `.NET` preset metadata still lives in `useAppBoot`.
* Publish output preflight has a correct validation-first/access-second contract, but Rust helper/test locality can be improved.

## Assumptions

* No compatibility layer should be added unless the user explicitly asks for compatibility in this conversation.
* Behavior should remain user-visible equivalent unless a review point explicitly calls for removing an old interface.
* The refactor should avoid speculative plugin-system work; provider/preset catalog work should stay at current product scope.
* Existing tests are the primary safety net, and new tests should be focused around the new deep module interfaces.

## Requirements

1. Publish config list deepening
   * Extract the middle-panel config list model from `PublishConfigPanel.tsx`.
   * Centralize recent/pubxml/userprofile key parsing, selection id derivation, visible ids, filter/group counts, and reorder projection.
   * Leave rendering behavior and existing UI semantics intact.

2. ProfileDomain deepening
   * Split profile list ownership, mutation operations, and quick-create/edit session behavior into clearer internal seams.
   * Keep `useProfiles` as the single public owner or replace it with one equivalently narrow public module; do not duplicate profile authority in dialogs.
   * Preserve repo-scoped async stale-result protections.

3. Publish runner deepening
   * Reduce the public and internal interfaces between runner/validate/execute so publish callers express intent, not implementation plumbing.
   * Keep backend-rendered command, output log ownership, preflight ordering, notification/tray behavior, and history record creation intact.

4. Store mutation contract unification
   * Make frontend store wrappers and Zustand mutation flows use one clear response contract for persisted mutations.
   * Remove ambiguous void/full-state mixed semantics where practical in this task.
   * Keep rollback/failure handling loud and testable.

5. Provider/preset catalog single authority
   * Move `.NET` preset metadata out of `useAppBoot` into a dedicated catalog module.
   * Avoid adding a large plugin system.
   * Keep provider metadata backend-owned and generated contracts type-safe.

6. Rust publish output preflight locality
   * Remove duplicated protected-output helper logic.
   * Keep `PublishOutputPreflightResult { output_dir, configured_output_dir, validation, access }` semantics.
   * Keep validation-first/access-second behavior and execution-time backend guardrail.

## Acceptance Criteria

* [ ] `PublishConfigPanel.tsx` no longer owns the config list model logic directly; model behavior is covered by focused tests.
* [ ] `useProfiles` public surface is smaller or internally delegates to deeper modules without adding a second profile owner.
* [ ] Publish runner still supports direct UI publish, tray publish, rerun, pubxml publish, preflight denial, protected-access retry, cancellation, record persistence, and notification feedback.
* [ ] Store mutations have one documented contract shape across frontend wrapper and Zustand usage for touched mutations.
* [ ] `.NET` presets are imported from a catalog module, not declared inside `useAppBoot`.
* [ ] Preflight protected-root helpers have one implementation path.
* [ ] No compatibility adapters, fallback branches, or deprecated old interfaces are kept unless explicitly justified by existing persisted data migration.
* [ ] `pnpm typecheck` passes.
* [ ] Focused Vitest suites for touched modules pass.
* [ ] Rust tests for touched preflight/store code pass.
* [ ] Browser/e2e geometry checks are run or explicitly called out if not run.

## Definition of Done

* Implementation is staged in small, reviewable units.
* Each unit has focused tests or a documented reason tests are not applicable.
* Final verification lists exactly what ran and what was skipped.
* Any behavior or interface removed is called out.
* No unrelated style churn or opportunistic cleanup.

## Out of Scope

* New provider plugin architecture.
* Visual redesign of the three-column UI.
* Rewriting Tauri command generation.
* Full migration of all legacy persisted-data handling unless required by touched contracts.
* Git commit/push unless explicitly requested later.

## Technical Notes

* Frontend specs to apply: `.trellis/spec/frontend/directory-structure.md`, `component-guidelines.md`, `hook-guidelines.md`, `state-management.md`, `type-safety.md`, `quality-guidelines.md`.
* Cross-layer and reuse guides apply because this task moves modules and changes shared contracts.
* Existing tests likely affected: `src/components/layout/__tests__/PublishConfigPanel.test.tsx`, `src/hooks/__tests__/useProfiles.test.ts`, `src/hooks/__tests__/usePublishRunner.test.ts`, `src/hooks/__tests__/useAppState.test.ts`, Rust publish preflight/store tests, and e2e floating-card checks.

## Proposed Execution Units

1. Catalog + store contract cleanup where safe and low-risk.
2. Publish config list model extraction with focused tests.
3. ProfileDomain internal split with existing profile tests kept green.
4. Publish runner interface cleanup with publish runner tests kept green.
5. Rust preflight helper/test locality cleanup.
6. Full verification and residual architecture sweep.
