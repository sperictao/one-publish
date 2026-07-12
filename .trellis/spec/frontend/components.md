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

## Geist Alignment Contract

`DESIGN.md` / `design.dark.md` are the styling source of truth; tokens live in `src/index.css` and `tailwind.config.cjs`. Concrete rules enforced across all pages and dialogs (2026-07 audit):

- Colors: Geist tokens only (semantic `bg-background`/`text-muted-foreground`/… or step `gray-*`/`gray-alpha-*`/accent scales). No raw hex/rgb/hsl literals and no stock Tailwind palette. `hsl(var(--text-fine))`, `--terminal-*`, and `--theme-preview-*` are registered exceptions.
- Typography: only `text-heading-*` / `text-label-*` / `text-copy-*` / `text-button-*` tokens; code/paths/identifiers use the `-mono` variants with `font-mono`. No `text-xs/sm/…`, no arbitrary `text-[Npx]`, no hand-written `leading-*`/`tracking-*`, no italics; ≤2 font weights per view.
- Radius families: controls/rows/chips/wells `rounded-sm` (6px); menus/popovers/modal containers and large inner panels `rounded-md` (12px); pills/avatars/circular icon buttons `rounded-full`. Never bare `rounded` (4px) or `rounded-lg` outside fullscreen surfaces.
- Control heights: 32px (`h-8`) small, 40px (`h-10`) medium/default and dialog footers, 48px large. `h-7`/`h-9`/`h-11` are off-scale.
- Spacing: 4px grid with the 8/16/32 rhythm; 20px (`p-5`/`gap-5`) and half-steps like `p-3.5` are off-scale (component-token paddings such as `px-2.5` for buttons are allowed).
- Hover/active: transparent fills tint with `hover:bg-gray-alpha-100` / `active:bg-gray-alpha-200` (never `hover:bg-accent`/`hover:bg-muted`); solid `bg-primary` hovers to `bg-gray-900`; borders step `border-border → hover:border-gray-alpha-500 → active:border-gray-alpha-600`.
- Disabled: `gray-100` fill + `gray-700` text + `cursor-not-allowed` (no `opacity-50` dimming). The `Switch` track keeps opacity dimming as the registered exception.
- Focus: every interactive element shows the two-layer ring via `.focus-ring` (or `surface-input` focus-within); never `outline-none` without a replacement.
- Motion: `duration-150 ease-geist` for state changes; looping animation only for in-progress indicators (spinners, indeterminate progress bars).
- Button variants map to DESIGN.md: `default`=primary (gray-1000), `secondary`=background-100 + alpha border, `ghost`=tertiary (gray-alpha tint hover), `destructive`=error (`red-800`, hover `red-900`).

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
