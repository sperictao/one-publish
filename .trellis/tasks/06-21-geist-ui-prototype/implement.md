# Implementation Plan

## Before Coding

- [x] User approves starting this child task.
- [x] Run `python3 ./.trellis/scripts/task.py start 06-21-geist-ui-prototype`.
- [x] Load `trellis-before-dev`.
- [x] Read:
  - `.trellis/tasks/06-21-geist-ui-prototype/prd.md`
  - `.trellis/tasks/06-21-geist-ui-prototype/design.md`
  - this file
  - parent task `prd.md` / `design.md`
  - frontend component/forms/quality specs.

## Build Prototype

- [x] Create `src/components/prototype/` with clearly named throwaway files.
- [x] Add `PrototypeVariantSwitcher`.
- [x] Add `GeistWorkbenchPrototype`.
- [x] Implement Variant A, B, and C as separate exported components.
- [x] Wire `App.tsx` to render the prototype only for supported `variant` params in development.
- [x] Ensure no variant query keeps the normal app rendering path.

## Browser Verification

- [x] Start renderer with `pnpm dev:renderer`.
- [x] Open:
  - `/?variant=A`
  - `/?variant=B`
  - `/?variant=C`
- [x] Confirm switcher click cycling.
- [x] Confirm arrow key cycling outside input controls.
- [x] Confirm switcher is visually distinct from the design.
- [x] Confirm dark mode still reads correctly.

## Automated Verification

- [x] `pnpm typecheck`
- [x] `npx react-doctor@latest --verbose --scope changed`
- [x] `git diff --check -- <touched files>`

## Handoff

- [x] Provide URLs for the three variants.
- [x] Ask user which direction or hybrid to absorb.
- [x] Record selected direction in `NOTES.md`.
- [x] Do not leave the parent task claiming production redesign is complete.

## Rollback

Remove:

- `src/components/prototype/`
- prototype branch in `src/App.tsx`

Normal app should return to previous behavior.
