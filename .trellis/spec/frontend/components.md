# Component Guidelines

Use the local UI primitives and existing accessibility patterns.

## UI Primitives

Import shared primitives from `src/components/ui/`:

- `Button`
- `Input`
- `Textarea`
- `Label`
- `Select`
- `Switch`
- `Dialog`
- `Card`
- `SectionShell`
- `AppDialogShell`

Use `lucide-react` icons for action buttons and section headers when an icon exists.

## Class Merging

- `cn` in `src/lib/utils.ts` wraps `tailwind-merge`; keep project typography tokens such as `text-button-*`, `text-label-*`, `text-copy-*`, and `text-heading-*` registered as `font-size` class group entries there.
- When adding new `text-*` typography tokens in `tailwind.config.cjs`, update `geistTextSizeTokens` and its regression tests. Otherwise `tailwind-merge` can treat the typography token as a text color and remove color utilities like `text-primary-foreground`, which makes black primary buttons lose their visible text.

## Accessibility

- Prefer native interactive elements.
- Pair text inputs and selects with `Label htmlFor`.
- Queryable names matter because component tests use roles and labels.
- For custom switch-like controls, set `type="button"`, `role="switch"`, `aria-checked`, and `aria-label`.

Reference files:

- `src/components/publish/DotnetPublishConfigFormSections.tsx`
- `src/components/publish/BooleanParameter.tsx`
- `src/components/publish/StringParameter.tsx`

## Toasts

Use `sonner` toasts for user-visible async feedback:

- Success after save/import/export/delete operations.
- Error with a concise title and `description` from the thrown error.

Reference file:

- `src/components/publish/ConfigDialog.tsx`

## Tests

Use `@testing-library/react` patterns:

- `screen.getByRole(...)` for buttons, switches, comboboxes, and textboxes.
- `screen.getByLabelText(...)` for fields.
- Assert visible behavior and callback payloads, not private component state.
