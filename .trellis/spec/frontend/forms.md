# Frontend Forms

Forms in this repo are controlled React forms built from local UI primitives. There is no form library in current examples.

## Core Pattern

- Parent hooks or containers own draft state.
- Inputs receive `value`/`checked` plus focused `onChange` callbacks.
- Save handlers validate only the UI-level requirement, call a wrapper action, and surface failures with `sonner` toasts.
- Disable submit buttons while saving or when required text is empty.
- Keep dialogs mounted only when needed when the existing component already uses that pattern.

Reference files:

- `src/components/publish/QuickCreateProfileDialog.tsx`
- `src/components/publish/ConfigDialog.tsx`
- `src/components/publish/DotnetPublishConfigFormSections.tsx`
- `src/components/layout/SettingsDialog.tsx`

## Field Components

Publish parameter controls use small typed components:

- `StringParameter` uses `Input`, `Label`, an optional `HelpCircle`, and a controlled string value.
- `BooleanParameter` uses `Switch`, `Label`, and a controlled boolean value.
- Array/map parameter components keep add/remove behavior local and report normalized values upward.

Reference files:

- `src/components/publish/StringParameter.tsx`
- `src/components/publish/BooleanParameter.tsx`
- `src/components/publish/ArrayParameter.tsx`
- `src/components/publish/MapParameter.tsx`

## Dialog Layout

Use the existing dialog shell primitives instead of inventing a parallel modal structure:

- `Dialog`
- `AppDialogShell`
- `AppDialogInset`
- `SectionShell`
- local `Button`, `Input`, `Label`, `Select`, `Switch`

Use `lucide-react` icons in section headers and buttons when the existing UI does.

## Tests

For form behavior, use Vitest + Testing Library:

- Query by role/label text rather than implementation details.
- Assert callbacks receive the expected patch or payload.
- Stub browser APIs used by Radix/layout code when needed, as in `QuickCreateProfileDialog.test.tsx`.

Reference tests:

- `src/components/publish/__tests__/QuickCreateProfileDialog.test.tsx`
- `src/components/publish/__tests__/ConfigDialog.test.tsx`
- `src/components/publish/__tests__/StringParameter.test.tsx`
- `src/components/publish/__tests__/BooleanParameter.test.tsx`

