# Implementation Plan

## Before Coding

- [x] Start this child task.
- [x] Load `trellis-before-dev`.
- [x] Read this task's `prd.md`, `design.md`, and `implement.md`.
- [x] Read prototype decision notes.
- [x] Read frontend component and quality specs.

## Implementation

- [x] Inspect current normal app shell against variant A.
- [x] Apply narrow layout/surface refinements to default app path.
- [x] Keep prototype route behavior unchanged.
- [x] Avoid changing handlers, stores, Tauri calls, or publish runtime behavior.
- [x] Remove B/C prototype variants and the multi-variant switcher.
- [x] Keep `?variant=A` as the only temporary comparison route.
- [x] Absorb selected A sidebar density into repository/config sidebars without changing list behavior.

## Verification

- [x] Normal route E2E smoke.
- [x] A-only prototype route E2E smoke.
- [x] B/C fallback E2E smoke.
- [x] Sidebar component tests.
- [x] `pnpm typecheck`.
- [x] `pnpm build:renderer`.
- [x] `npx react-doctor@latest --verbose --scope changed`.
- [x] `git diff --check -- <touched files>`.

## Handoff

- [x] Summarize what moved into production.
- [x] State that only A prototype code remains temporarily for comparison.
