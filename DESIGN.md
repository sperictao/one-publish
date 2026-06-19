---
version: 1.0
name: OnePublish-Liquid-Glass-Design-System
description: A depth-first desktop UI that turns publishing into a tactile glass surface. Translucent panels stack on a warm near-white canvas, framed by SF Pro Display headlines with negative letter-spacing and a single Action Blue (HSL 220 72% 50%) interactive color. Real backdrop-blur, specular highlights, and spring physics let the chrome become the material — every surface refracts, every press responds, every motion springs. UI is the artifact.

colors:
  primary: "hsl(220 72% 50%)"
  primary-focus: "hsl(220 72% 58%)"
  primary-on-dark: "#2997ff"
  ink: "hsl(24 10% 10%)"
  body: "hsl(24 10% 10%)"
  body-on-dark: "hsl(30 10% 95%)"
  body-muted: "hsl(30 6% 60%)"
  ink-muted-80: "#333333"
  ink-muted-48: "#86868b"
  divider-soft: "var(--glass-divider)"
  hairline: "var(--glass-border-subtle)"
  canvas: "hsl(30 15% 98%)"
  canvas-parchment: "hsl(30 15% 99%)"
  surface-pearl: "var(--glass-panel-bg)"
  surface-tile-1: "rgba(30,30,35,0.82)"
  surface-tile-2: "hsl(24 8% 13%)"
  surface-tile-3: "hsl(24 8% 10%)"
  surface-black: "hsl(222 47% 11%)"
  surface-chip-translucent: "rgba(255,255,255,0.4)"
  on-primary: "hsl(0 0% 100%)"
  on-dark: "hsl(30 10% 95%)"
  glass-bg: "rgba(255,253,250,0.62)"
  glass-bg-hover: "rgba(255,253,250,0.72)"
  glass-bg-active: "rgba(255,253,250,0.82)"
  glass-panel-bg: "rgba(250,249,247,0.78)"
  glass-input-bg: "rgba(0,0,0,0.05)"
  glass-overlay: "rgba(0,0,0,0.18)"
  glass-code-bg: "rgba(0,0,0,0.06)"
  glass-border: "rgba(0,0,0,0.12)"
  glass-border-subtle: "rgba(0,0,0,0.08)"
  glass-divider: "rgba(0,0,0,0.1)"
  glass-kbd-bg: "rgba(0,0,0,0.06)"
  glass-kbd-border: "rgba(0,0,0,0.12)"
  glass-specular: "linear-gradient(135deg, rgba(255,255,255,0.4) 0%, rgba(255,255,255,0.05) 50%, transparent 100%)"
  glass-shadow: "0 2px 16px rgba(0,0,0,0.08), 0 0 1px rgba(0,0,0,0.12)"
  glass-shadow-lg: "0 8px 32px rgba(0,0,0,0.12), 0 0 1px rgba(0,0,0,0.15)"
  glass-shadow-selected: "0 4px 24px rgba(0,0,0,0.1), 0 0 0 1px rgba(0,0,0,0.08) inset"
  glass-inset-shadow: "inset 0 1px 3px rgba(0,0,0,0.06)"

typography:
  hero-display:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 56px
    fontWeight: 600
    lineHeight: 1.07
    letterSpacing: -0.28px
  display-lg:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 40px
    fontWeight: 600
    lineHeight: 1.1
    letterSpacing: 0
  display-md:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 34px
    fontWeight: 600
    lineHeight: 1.47
    letterSpacing: -0.374px
  lead:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 28px
    fontWeight: 400
    lineHeight: 1.14
    letterSpacing: 0.196px
  lead-airy:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 24px
    fontWeight: 300
    lineHeight: 1.5
    letterSpacing: 0
  tagline:
    fontFamily: "SF Pro Display, system-ui, -apple-system, sans-serif"
    fontSize: 21px
    fontWeight: 600
    lineHeight: 1.19
    letterSpacing: 0.231px
  body-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 600
    lineHeight: 1.24
    letterSpacing: -0.374px
  body:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 1.47
    letterSpacing: -0.374px
  dense-link:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 17px
    fontWeight: 400
    lineHeight: 2.41
    letterSpacing: 0
  caption:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.43
    letterSpacing: -0.224px
  caption-strong:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 600
    lineHeight: 1.29
    letterSpacing: -0.224px
  button-large:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 18px
    fontWeight: 300
    lineHeight: 1.0
    letterSpacing: 0
  button-utility:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.29
    letterSpacing: -0.224px
  fine-print:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.12px
  micro-legal:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 10px
    fontWeight: 400
    lineHeight: 1.3
    letterSpacing: -0.08px
  nav-link:
    fontFamily: "SF Pro Text, system-ui, -apple-system, sans-serif"
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.0
    letterSpacing: -0.12px

rounded:
  none: 0px
  xs: 6px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 16px
  pill: 9999px
  full: 9999px

blur:
  panel: 40px
  surface: 20px
  card: 24px
  input: 8px
  overlay: 12px
  popover: 32px

saturate:
  panel: 180%
  surface: 150%
  card: 160%
  input: 100%

spring:
  standard: "cubic-bezier(0.34, 1.56, 0.64, 1)"
  smooth: "cubic-bezier(0.2, 0.8, 0.2, 1)"
  bounce: "cubic-bezier(0.34, 1.3, 0.64, 1)"
  duration-press: 0.1s
  duration-hover: 0.35s
  duration-transition: 0.2s
  duration-stagger: 0.35s
  stagger-step: 30ms

spacing:
  xxs: 4px
  xs: 8px
  sm: 12px
  md: 17px
  lg: 24px
  xl: 32px
  xxl: 48px
  section: 80px

components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: 11px 22px
  button-primary-focus:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  button-primary-active:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    rounded: "{rounded.pill}"
  button-secondary-pill:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.primary}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: 11px 22px
  button-dark-utility:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.on-dark}"
    typography: "{typography.button-utility}"
    rounded: "{rounded.sm}"
    padding: 8px 15px
  button-pearl-capsule:
    backgroundColor: "{colors.surface-pearl}"
    textColor: "{colors.ink-muted-80}"
    typography: "{typography.caption}"
    rounded: "{rounded.md}"
    padding: 8px 14px
  button-store-hero:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.on-primary}"
    typography: "{typography.button-large}"
    rounded: "{rounded.pill}"
    padding: 14px 28px
  button-icon-circular:
    backgroundColor: "{colors.surface-chip-translucent}"
    textColor: "{colors.ink}"
    rounded: "{rounded.full}"
    size: 44px
  text-link:
    backgroundColor: transparent
    textColor: "{colors.primary}"
    typography: "{typography.body}"
  text-link-on-dark:
    backgroundColor: transparent
    textColor: "{colors.primary-on-dark}"
    typography: "{typography.body}"
  global-nav:
    backgroundColor: "{colors.surface-black}"
    textColor: "{colors.on-dark}"
    typography: "{typography.nav-link}"
    height: 44px
  sub-nav-frosted:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.tagline}"
    height: 52px
  product-tile-light:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.none}"
    padding: 80px
  product-tile-parchment:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.none}"
    padding: 80px
  product-tile-dark:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.on-dark}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.none}"
    padding: 80px
  product-tile-dark-2:
    backgroundColor: "{colors.surface-tile-2}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  product-tile-dark-3:
    backgroundColor: "{colors.surface-tile-3}"
    textColor: "{colors.on-dark}"
    rounded: "{rounded.none}"
  store-utility-card:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body-strong}"
    rounded: "{rounded.lg}"
    padding: 24px
  configurator-option-chip:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.caption}"
    rounded: "{rounded.pill}"
    padding: 12px 16px
  configurator-option-chip-selected:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
  search-input:
    backgroundColor: "{colors.canvas}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    rounded: "{rounded.pill}"
    padding: 12px 20px
    height: 44px
  floating-sticky-bar:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink}"
    typography: "{typography.body}"
    height: 64px
    padding: 12px 32px
  environment-quote-card:
    backgroundColor: "{colors.surface-tile-1}"
    textColor: "{colors.on-dark}"
    typography: "{typography.display-lg}"
    rounded: "{rounded.none}"
    padding: 80px
  footer:
    backgroundColor: "{colors.canvas-parchment}"
    textColor: "{colors.ink-muted-80}"
    typography: "{typography.fine-print}"
    padding: 64px

  # ── Liquid Glass material components ──
  glass-panel:
    backgroundColor: "{colors.glass-panel-bg}"
    backdropFilter: "blur({blur.panel}) saturate({saturate.panel})"
    border: "1px solid {colors.glass-divider}"
    rounded: "{rounded.lg}"
  glass-surface:
    backgroundColor: "{colors.glass-bg}"
    backdropFilter: "blur({blur.surface}) saturate({saturate.surface})"
    border: "1px solid {colors.glass-border}"
    boxShadow: "{colors.glass-shadow}"
    rounded: "{rounded.md}"
    specular: "{colors.glass-specular}"
  glass-surface-hover:
    backgroundColor: "{colors.glass-bg-hover}"
    boxShadow: "{colors.glass-shadow-lg}"
    transform: "translateY(-1px)"
  glass-surface-selected:
    backgroundColor: "{colors.glass-bg-active}"
    backdropFilter: "blur({blur.surface}) saturate({saturate.panel})"
    boxShadow: "{colors.glass-shadow-selected}"
    rounded: "{rounded.md}"
  glass-card:
    backgroundColor: "{colors.glass-panel-bg}"
    backdropFilter: "blur({blur.card}) saturate({saturate.card})"
    border: "1px solid {colors.glass-border}"
    boxShadow: "{colors.glass-shadow}"
    rounded: "{rounded.lg}"
    specular: "{colors.glass-specular}"
  glass-card-interactive:
    hover:
      transform: "translateY(-1px)"
      boxShadow: "{colors.glass-shadow-lg}"
    active:
      transform: "translateY(0) scale(0.97)"
      duration: "{spring.duration-press}"
  glass-input:
    backgroundColor: "{colors.glass-input-bg}"
    backdropFilter: "blur({blur.input})"
    border: "1px solid {colors.glass-border-subtle}"
    boxShadow: "{colors.glass-inset-shadow}"
    rounded: "{rounded.md}"
    focusWithin:
      boxShadow: "0 0 0 3px hsl({colors.primary} / 0.12)"
  glass-input-dark:
    backgroundColor: "rgba(255,255,255,0.06)"
    boxShadow: "inset 0 1px 3px rgba(0,0,0,0.2)"
  glass-divider:
    borderColor: "{colors.glass-divider}"
  glass-overlay:
    backgroundColor: "{colors.glass-overlay}"
    backdropFilter: "blur({blur.overlay})"
  glass-kbd:
    backgroundColor: "{colors.glass-kbd-bg}"
    border: "1px solid {colors.glass-kbd-border}"
    typography: "{typography.caption}"
    rounded: "{rounded.sm}"
  glass-dialog:
    backgroundColor: "{colors.glass-panel-bg}"
    backdropFilter: "blur({blur.panel}) saturate({saturate.panel})"
    border: "1px solid {colors.glass-border}"
    boxShadow: "{colors.glass-shadow-lg}"
    rounded: "{rounded.lg}"
  glass-popover:
    backgroundColor: "{colors.glass-panel-bg}"
    backdropFilter: "blur({blur.popover}) saturate({saturate.panel})"
    border: "1px solid {colors.glass-border}"
    boxShadow: "{colors.glass-shadow-lg}"
    rounded: "{rounded.md}"
  glass-toast:
    backgroundColor: "{colors.glass-panel-bg}"
    backdropFilter: "blur({blur.popover}) saturate({saturate.panel})"
    border: "1px solid {colors.glass-border}"
    rounded: "{rounded.md}"
  glass-code-block:
    backgroundColor: "{colors.glass-code-bg}"
    rounded: "{rounded.md}"
  glass-scrollbar:
    defaultColor: "transparent"
    hoverColor: "hsl(var(--muted-foreground) / 0.3)"
---

## Overview

OnePublish's interface is a masterclass in **tactile glass surfaces framed by spring physics**. Every screen is a stack of translucent panels — glass refraction over a warm near-white canvas, each carrying a headline, a parameter form, and a single blue primary action. Nothing competes with the task. Typography is confident but quiet; surfaces are translucent composites of `backdrop-blur` + `saturate`; interactive elements respond with a single, quiet blue and a haptic `scale(0.97)` press.

Density is deliberately moderate for a desktop tool. Panels stack with `{glass-panel}` (40px blur) as the chassis, `{glass-surface}` (20px blur) as interactive regions, and `{glass-card}` (24px blur) as content tiles. Elevation is layered through three shadow tokens — `{glass-shadow}` at rest, `{glass-shadow-lg}` on hover-lift, `{glass-shadow-selected}` for the active step. The result is an interface that feels physical: surfaces refract the canvas behind them, light catches a `::before` specular highlight, and every state change springs rather than fades.

Dark and light surfaces share the same chassis but switch material recipes. The light recipe uses warm translucent whites (`rgba(255,253,250,0.62)` → `0.82` as state intensifies); the dark recipe uses translucent whites over a near-black base (`rgba(255,255,255,0.08)` → `0.16`). The specular highlight dims from a 0.4 alpha sweep to a 0.1 alpha sweep so it never blows out on dark glass. Across both themes the typographic system, spacing rhythm, blur hierarchy, and the single blue accent are consistent — this is one design language expressed at two opacities.

**Key Characteristics:**
- Depth-first presentation; the chrome IS the material — glass refracts, surfaces lift, presses respond.
- Stacked translucent surfaces: `{glass-panel}` (chassis) → `{glass-card}` (content) → `{glass-surface}` (interaction), each with a graded blur radius (40 → 24 → 20px).
- Single blue accent (`{colors.primary}` — HSL 220 72% 50%) carries every interactive element. No second brand color exists.
- Three button grammars: primary blue pill (`{rounded.pill}`), glass utility (`{glass-surface}` + `{rounded.md}`), and icon-circular (`{rounded.full}`).
- SF Pro Display + SF Pro Text — negative letter-spacing at display sizes for the signature "Apple tight" headline feel.
- Layered elevation through three shadow tokens — rest / hover-lift / selected — with `translateY(-1px)` on hover to deepen the sense of approach.
- Spring physics over linear easing: every transform uses `cubic-bezier(0.34, 1.56, 0.64, 1)` (slight overshoot); every color/bg transition uses `cubic-bezier(0.2, 0.8, 0.2, 1)` (no overshoot).
- List entrance is staggered at `{spring.stagger-step}` (30ms) increments, capped at 8 levels (240ms).
- Auto-hiding scrollbars: transparent at rest, `muted-foreground/0.3` on hover — Apple-style chrome recession.

## Colors

> **Source:** `src/index.css` — `:root` (light) and `.dark` (dark). The color system is split into two layers: semantic shadcn HSL tokens (the base canvas/ink/primary) and the Liquid Glass material layer (translucent rgba composites built on top).

### Brand & Accent
- **Action Blue** (`{colors.primary}` — `hsl(220 72% 50%)`): The single brand-level interactive color. All text links, all primary pill CTAs ("Publish", "Run"), the focus ring root, and the selected-state ring. This is the universal "click me / this is active" signal. In dark mode it brightens to `{colors.primary-focus}` (`hsl(220 72% 58%)`) so it reads against the dark glass.
- **Focus Blue** (`{colors.primary-focus}` — `hsl(220 72% 58%)`): The dark-mode primary and the keyboard focus ring tint. Applied as `box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12)` via `{glass-input.focusWithin}` and `{glass-focus-ring}`.
- **Sky Link Blue** (`{colors.primary-on-dark}` — #2997ff): Reserved for inline links and accents sitting directly on dark photographic / terminal surfaces (`{colors.surface-black}`), where Action Blue would lose contrast.

### Glass Material Layer (light)
- **Glass BG** (`{colors.glass-bg}` — `rgba(255,253,250,0.62)`): The default fill for interactive glass surfaces — warm translucent white. The 0.62 alpha lets the canvas refract through.
- **Glass BG Hover** (`{colors.glass-bg-hover}` — `rgba(255,253,250,0.72)`): A 10-point opacity lift on hover, paired with `{glass-shadow-lg}` and `translateY(-1px)`.
- **Glass BG Active** (`{colors.glass-bg-active}` — `rgba(255,253,250,0.82)`): The most opaque warm white — used for selected surfaces and active steps. Reads as "pressed in / chosen".
- **Glass Panel BG** (`{colors.glass-panel-bg}` — `rgba(250,249,247,0.78)`): The chassis layer for panels, cards, dialogs, popovers. Slightly cooler and more opaque than `glass-bg` so containers feel structurally heavier than their contents.
- **Glass Input BG** (`{colors.glass-input-bg}` — `rgba(0,0,0,0.05)`): A faint dark wash over the canvas for input wells — creates the recessed/inset feel paired with `{glass-inset-shadow}`.
- **Glass Overlay** (`{colors.glass-overlay}` — `rgba(0,0,0,0.18)`): The dialog/scrim backdrop. Light enough to keep context visible, heavy enough to focus the modal.
- **Glass Code BG** (`{colors.glass-code-bg}` — `rgba(0,0,0,0.06)`): The recessed surface for log/terminal blocks embedded inside glass panels.

### Glass Material Layer (dark)
> In dark mode every alpha inverts: warm whites → translucent whites over near-black. The values are tuned so the *visual weight* matches the light recipe, not the literal alpha.
- **Glass BG** → `rgba(255,255,255,0.08)`, **Hover** → `0.12`, **Active** → `0.16`.
- **Glass Panel BG** → `rgba(30,30,35,0.82)` — the dark chassis, opaque enough to anchor the window but translucent enough to feel like glass.
- **Glass Input BG** → `rgba(255,255,255,0.06)` with `{glass-inset-shadow}` → `inset 0 1px 3px rgba(0,0,0,0.2)`.
- **Glass Overlay** → `rgba(0,0,0,0.45)` — heavier scrim for dark theme focus.
- **Glass Specular** → `linear-gradient(135deg, rgba(255,255,255,0.1) 0%, rgba(255,255,255,0.02) 50%, transparent 100%)` — the highlight sweep is dimmed 4× so it never blows out on dark glass.

### Surface
- **Canvas** (`{colors.canvas}` — `hsl(30 15% 98%)`): The warm near-white page background. Not pure white — the 15° hue / 15% sat gives the whole app a faint warm cast that makes the glass refraction read as light rather than glare.
- **Parchment** (`{colors.canvas-parchment}` — `hsl(30 15% 99%)`): A near-white used for alternating container sections and the card surface. One step lighter than canvas for the faintest separation.
- **Pearl Button** (`{colors.surface-pearl}` → `{colors.glass-panel-bg}`): The secondary "ghost" surface — now expressed as the glass panel material itself, so secondary buttons share the chassis translucency.
- **Near-Black Tile 1** (`{colors.surface-tile-1}` — `rgba(30,30,35,0.82)`): The dark glass chassis. Used for dark-mode panels and the terminal surface base.
- **Near-Black Tile 2** (`{colors.surface-tile-2}` — `hsl(24 8% 13%)`): A solid dark card surface — used where translucency would muddy content (e.g. dense config lists).
- **Near-Black Tile 3** (`{colors.surface-tile-3}` — `hsl(24 8% 10%)`): The deepest solid dark — the dark-mode page background equivalent.
- **Terminal Black** (`{colors.surface-black}` — `hsl(222 47% 11%)`): Reserved for the publish log / terminal panel — intentionally dark and blue-shifted for log legibility, exposed as `--terminal-bg`.
- **Translucent Chip** (`{colors.surface-chip-translucent}` — `rgba(255,255,255,0.4)`): The base of circular icon buttons floating over glass. In production paired with the specular highlight to read as a polished glass bead.

### Text
- **Near-Black Ink** (`{colors.ink}` — `hsl(24 10% 10%)`): The voice of every headline and body paragraph on light surfaces. Warm near-black, not pure black — keeps the page feeling lit rather than printed.
- **Body** (`{colors.body}` — `hsl(24 10% 10%)`): Same as ink — one near-black tone for all text on light glass.
- **Body On Dark** (`{colors.body-on-dark}` — `hsl(30 10% 95%)`): All text on dark glass and the terminal panel.
- **Body Muted** (`{colors.body-muted}` — `hsl(30 6% 60%)`): Secondary copy and `muted-foreground` — the quiet label tone.
- **Ink Muted 80** (`{colors.ink-muted-80}` — #333333): Body text on the lighter Pearl surface.
- **Ink Muted 48** (`{colors.ink-muted-48}` — #86868b): Disabled text, fine-print, and the settings secondary label tone (Apple's signature `#86868b` gray).

### Hairlines & Borders
- **Divider Soft** (`{colors.divider-soft}` → `{colors.glass-divider}` — `rgba(0,0,0,0.1)`): The divider tone between panels and list rows. Functions as a refracted edge, not a hard line.
- **Hairline** (`{colors.hairline}` → `{colors.glass-border-subtle}` — `rgba(0,0,0,0.08)`): The 1px subtle border on inputs and inset cards.
- **Glass Border** (`{colors.glass-border}` — `rgba(0,0,0,0.12)`): The primary 1px border on cards, surfaces, and dialogs — the visible glass edge.

### Brand Gradient
**No decorative gradients** — with one intentional exception. The `{colors.glass-specular}` token is a *material* gradient (135° white sweep), not a decorative one: it simulates light catching the glass surface via a `::before` pseudo-element. It is `pointer-events: none` and never carries content. All other depth comes from `backdrop-blur` refraction and layered shadows, never from CSS color gradients.

## Typography

### Font Family
- **Display**: `SF Pro Display, system-ui, -apple-system, sans-serif` — Apple's proprietary display face, optimized for sizes ≥ 19px. Defines the voice of every headline.
- **Body / UI**: `SF Pro Text, system-ui, -apple-system, sans-serif` — the text-optimized variant used for body copy, captions, buttons, and links below 20px.
- **OpenType features**: `font-variant-numeric: numerator` is enabled on numeric links (pricing tables, spec sheets). Display sizes rely on tight tracking rather than contextual ligatures.

### Hierarchy

| Token | Size | Weight | Line Height | Letter Spacing | Use |
|---|---|---|---|---|---|
| `{typography.hero-display}` | 56px | 600 | 1.07 | -0.28px | Hero headline; the signature "Apple tight" tracking |
| `{typography.display-lg}` | 40px | 600 | 1.10 | 0 | Panel/dialog headlines atop every glass surface |
| `{typography.display-md}` | 34px | 600 | 1.47 | -0.374px | Section heads (SF Pro Text at display proportions) |
| `{typography.lead}` | 28px | 400 | 1.14 | 0.196px | Panel subcopy, dialog lead lines |
| `{typography.lead-airy}` | 24px | 300 | 1.5 | 0 | Environment-page lead paragraphs (the rare weight 300) |
| `{typography.tagline}` | 21px | 600 | 1.19 | 0.231px | Sub-tile tagline; sub-nav category name |
| `{typography.body-strong}` | 17px | 600 | 1.24 | -0.374px | Inline strong emphasis |
| `{typography.body}` | 17px | 400 | 1.47 | -0.374px | Default paragraph |
| `{typography.dense-link}` | 17px | 400 | 2.41 | 0 | Footer / store utility link lists (relaxed leading) |
| `{typography.caption}` | 14px | 400 | 1.43 | -0.224px | Secondary captions, button text |
| `{typography.caption-strong}` | 14px | 600 | 1.29 | -0.224px | Emphasized captions |
| `{typography.button-large}` | 18px | 300 | 1.0 | 0 | Store hero CTAs (the rare weight 300) |
| `{typography.button-utility}` | 14px | 400 | 1.29 | -0.224px | Utility/nav button labels |
| `{typography.fine-print}` | 12px | 400 | 1.0 | -0.12px | Fine-print, footer body |
| `{typography.micro-legal}` | 10px | 400 | 1.3 | -0.08px | Micro legal disclaimers |
| `{typography.nav-link}` | 12px | 400 | 1.0 | -0.12px | Global nav menu items |

### Principles

- **Negative letter-spacing at display sizes.** Every headline at 17px and up carries a slight tracking tighten (`-0.12 → -0.374px`). This produces the iconic "Apple tight" headline cadence. Never used at 12px or below.
- **Body copy at 17px, not 16px.** Apple breaks the SaaS convention and runs paragraph text at 17px. The extra pixel gives the page an unmistakable "reading, not scanning" pace.
- **Weight 300 is real and rare.** Used deliberately on a handful of large-size reads (`{typography.button-large}` at 18px/300 and `{typography.lead-airy}` at 24px/300). It's not an accident — it's a light-atmosphere cue reserved for moments where the content should feel airy.
- **Weight 600, not 700, for headlines.** Apple's headlines sit at weight 600. Weight 700 is used sparingly for `{typography.tagline}` (21px) when a touch more assertion is needed.
- **Line-height is context-specific.** Display sizes use 1.07–1.19 (tight). Body uses 1.47. Utility link stacks in the footer/store use an unusually relaxed 2.41 (`{typography.dense-link}`). The 2.41 is not a bug — it's how the footer's dense link columns breathe.
- **Weight 500 is deliberately absent.** The ladder is 300 / 400 / 600 / 700. Mid-weight readings always use 600.

### Note on Font Substitutes
SF Pro is Apple's proprietary system font. When building off-system:

- Use `system-ui, -apple-system, BlinkMacSystemFont` as the first stack entry — on macOS/iOS/Safari this resolves to the real SF Pro.
- For non-Apple platforms, **Inter** (Google Fonts, variable) is the closest open-source equivalent. Inter at weight 600 with `font-feature-settings: "ss03"` approximates SF Pro's rounded "a" character.
- Nudge `letter-spacing` down by `-0.01em` on display sizes to re-create the Apple tight feel; Inter's default tracking runs slightly wider than SF Pro.
- For body text, tighten line-height by `0.03` (from 1.47 → 1.44) when substituting Inter — Inter's taller x-height needs less leading.

## Layout

### Spacing System
- **Base unit:** 8px. Sub-base values (2, 4, 6) are used for tight typographic adjustments; structural layout snaps to 8/12/16/24/32.
- **Tokens:** `{spacing.xxs}` 4px · `{spacing.xs}` 8px · `{spacing.sm}` 12px · `{spacing.md}` 17px · `{spacing.lg}` 24px · `{spacing.xl}` 32px · `{spacing.xxl}` 48px · `{spacing.section}` 80px.
- **Panel padding:** `{spacing.lg}` (24px) inside `{glass-panel}` and `{glass-card}` containers.
- **Dialog padding:** header `{spacing.lg}` (24px), body scroll region `{spacing.lg}` (24px), footer action bar `{spacing.sm}` × `{spacing.lg}` (12px × 24px).
- **Button padding:** 8–11px vertical, 15–22px horizontal; hero CTA 14px × 28px.
- **Universal rhythm constants:** the 17px body line-height multiplier (~25px line) and 21px tagline size anchor the typographic rhythm across every panel.

### Window & Panel Layout
OnePublish is a desktop app, not a scrolling web page. The window is a fixed chassis divided into persistent regions:
- **Left sidebar** (`{glass-panel}` + `repo-sidebar-shell` gradient): repository list + branch panel, resizable via `{ResizeHandle}`.
- **Center content** (the canvas): publish config form, parameter editors, command import — the primary task surface, scrollable with `{glass-scrollbar}`.
- **Right rail** (collapsible `{CollapsiblePanel}`): execution log / terminal (`{colors.surface-black}` + `{colors.glass-code-bg}`).
- **Dialogs** (`{glass-dialog}`): settings, shortcuts, environment check, release checklist, command import — modal overlays on `{glass-overlay}`.

### Whitespace Philosophy
Glass surfaces need air to refract. Every panel begins with at least `{spacing.lg}` (24px) of internal padding; the gap between stacked glass cards is `{spacing.sm}` (12px). The terminal panel is the one area that goes dense — log lines pack at 1.3 line-height because readability there is about scan, not reading.

## Elevation & Depth

| Level | Treatment | Use |
|---|---|---|
| Canvas | No blur, no border — the warm page background | The base layer behind everything |
| Glass panel | `{blur.panel}` (40px) + `saturate(180%)` over `{glass-panel-bg}` | Chassis: sidebars, collapsible panels, dialog shells |
| Glass card | `{blur.card}` (24px) + `saturate(160%)` + `{glass-shadow}` | Content tiles, settings sections, result previews |
| Glass surface | `{blur.surface}` (20px) + `saturate(150%)` + `{glass-shadow}` + specular | Interactive regions: list items, selectable cells |
| Glass surface (hover) | `{glass-bg-hover}` + `{glass-shadow-lg}` + `translateY(-1px)` | Hover-lift — the surface approaches the user |
| Glass surface (selected) | `{glass-bg-active}` + `{glass-shadow-selected}` | Active step, current branch, chosen option |
| Glass input | `{blur.input}` (8px) + `{glass-inset-shadow}` (recessed) | Input wells, search boxes — pressed into the surface |
| Overlay | `{glass-overlay}` + `{blur.overlay}` (12px) | Dialog scrim — dims and blurs the context behind |
| Terminal | Solid `{surface-black}`, no blur | Log panel — intentionally flat-dark for contrast |

**Depth philosophy.** Unlike flat web design, OnePublish builds depth through *layered translucency*: each glass layer refracts the layer beneath it, and the blur radius decreases with interaction proximity (panel 40px → card 24px → surface 20px → input 8px). Shadows are not decorative — `{glass-shadow}` is the resting weight, `{glass-shadow-lg}` is the "this is closer" signal on hover, and `{glass-shadow-selected}` adds an inset ring to mark the chosen state. The specular `::before` highlight is the final layer: a `pointer-events: none` light sweep that makes the surface read as polished glass, never as flat plastic.

## Motion & Spring Physics

All state changes use **spring physics, never linear or ease-in-out**. This is the single most important non-visual token in the system.

| Curve | cubic-bezier | Duration | Use |
|---|---|---|---|
| `{spring.standard}` | `0.34, 1.56, 0.64, 1` | 0.2–0.35s | Transforms: translate, scale (slight overshoot) |
| `{spring.smooth}` | `0.2, 0.8, 0.2, 1` | 0.2s | Colors, backgrounds, opacity (no overshoot) |
| `{spring.bounce}` | `0.34, 1.3, 0.64, 1` | 0.3s | Playful bounces (rare) |

**Interaction micro-animations:**
- **Press** (`glass-press`): `:active { transform: scale(0.97) }` at `{spring.duration-press}` (0.1s) — instant haptic response. Applied to every button, switch, select trigger, dialog close, and checklist step.
- **Hover-lift** (`glass-hover-lift`): `:hover { transform: translateY(-1px); box-shadow: {glass-shadow-lg} }` at `{spring.duration-hover}` (0.35s).
- **Interactive combo** (`glass-interactive`): hover-lift + press-scale combined — used on clickable cards.
- **Stagger entrance** (`glass-stagger`): children fade+rise (`opacity 0→1`, `translateY(6px→0)`) with `{spring.stagger-step}` (30ms) incremental delay, capped at 8 levels (240ms). Applied to branch lists, shortcut lists, checklist steps.
- **Focus ring** (`glass-focus-ring`): `box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15)` springs from 0→3px over 0.3s.
- **Scrollbar** (`glass-scrollbar`): transparent at rest, `muted-foreground/0.3` on hover — Apple-style auto-hide.

**Accessibility:** `@media (prefers-reduced-motion: reduce)` zeroes all durations to 0.01ms and disables transforms — the system degrades to instant state changes with no motion.

## Shapes

### Border Radius Scale

| Token | Value | Use |
|---|---|---|
| `{rounded.none}` | 0px | Terminal panel inner edges (rare) |
| `{rounded.xs}` | 6px | Inline chips, small indicators |
| `{rounded.sm}` | 8px | kbd labels, small tags, utility buttons |
| `{rounded.md}` | 12px | Buttons, inputs, list items, glass surfaces, popovers |
| `{rounded.lg}` | 16px | Cards, panels, dialogs — the primary container radius |
| `{rounded.xl}` | 16px | Alias of lg for large containers |
| `{rounded.pill}` | 9999px | Primary blue CTA, search input, switches (track) |
| `{rounded.full}` | 9999px / 50% | Circular icon buttons, avatars, switch thumb |

**Radius philosophy.** The radius escalates with container size: small interactive elements at 12px, containers at 16px, the signature pill reserved for the primary action and search. Never mix — a card at 16px should not contain a button at 16px; the button drops to 12px so the hierarchy reads.

## Components

### Glass Material Components

**`glass-panel`** — The chassis. Background `{colors.glass-panel-bg}` (`rgba(250,249,247,0.78)`), `backdrop-filter: blur({blur.panel}) saturate({saturate.panel})` (40px / 180%), 1px `{colors.glass-divider}` border, `{rounded.lg}` (16px). The highest blur in the system — used for sidebars, collapsible panels, and dialog shells. This is the structural glass that everything else sits on.

**`glass-surface`** — Interactive region. Background `{colors.glass-bg}` (`rgba(255,253,250,0.62)`), `backdrop-filter: blur({blur.surface}) saturate({saturate.surface})` (20px / 150%), 1px `{colors.glass-border}`, `{glass-shadow}`, `{rounded.md}` (12px). Carries a `::before` specular highlight (`{colors.glass-specular}`). Used for selectable list items, settings nav, and standalone interaction zones.
- Hover: `{glass-surface-hover}` — bg → `{glass-bg-hover}`, shadow → `{glass-shadow-lg}`, `translateY(-1px)`.
- Selected: `{glass-surface-selected}` — bg → `{glass-bg-active}` (0.82), blur 24px, `{glass-shadow-selected}` (with inset ring).

**`glass-card`** — Content tile. Background `{colors.glass-panel-bg}`, `backdrop-filter: blur({blur.card}) saturate({saturate.card})` (24px / 160%), 1px `{colors.glass-border}`, `{glass-shadow}`, `{rounded.lg}` (16px). Weaker specular than `glass-surface`. The base style for shadcn `Card`. Add `glass-interactive` to make it clickable (hover-lift + press).

**`glass-input`** — Recessed input well. Background `{colors.glass-input-bg}` (`rgba(0,0,0,0.05)`), `backdrop-filter: blur({blur.input})` (8px), 1px `{colors.glass-border-subtle}`, `{glass-inset-shadow}` (inset, pressed-in feel), `{rounded.md}` (12px). On `:focus-within`: ring `0 0 0 3px hsl(var(--primary) / 0.12)` + border deepens. In dark mode the inset shadow intensifies to `inset 0 1px 3px rgba(0,0,0,0.2)`.

**`glass-dialog`** — Modal surface. Background `{colors.glass-panel-bg}`, `backdrop-filter: blur({blur.panel}) saturate({saturate.panel})`, 1px `{colors.glass-border}`, `{glass-shadow-lg}`, `{rounded.lg}` (16px). Sits on `{glass-overlay}` (scrim at `{blur.overlay}`). Content enters with zoom + slide.

**`glass-popover`** / **`glass-toast`** — Floating transient surfaces. Same chassis as `glass-dialog` but `{blur.popover}` (32px) and `{rounded.md}`. Select dropdowns, tooltips, and Sonner toasts all share this recipe.

**`glass-kbd`** — Keyboard shortcut label. Background `{colors.glass-kbd-bg}`, 1px `{colors.glass-kbd-border}`, `{typography.caption}`, `{rounded.sm}` (8px). The quiet chip that denotes a hotkey.

**`glass-divider`** — Replaces hard borders. `border-color: {colors.glass-divider}` (`rgba(0,0,0,0.1)`). Used between panels, list rows, and dialog sections — reads as a refracted edge, not a drawn line.

### Buttons

**`button-primary`** — The signature action. Background `{colors.primary}` (Action Blue `hsl(220 72% 50%)`), text `{colors.on-primary}` in `{typography.body}` (17px / 400), rounded `{rounded.pill}`, padding 11px × 22px. Carries `glass-press` (scale 0.97 on active).
- Focus: `{button-primary-focus}` — `box-shadow: 0 0 0 3px hsl(var(--primary) / 0.15)`.

**`button-secondary-pill`** — Ghost pill. Transparent bg, text `{colors.primary}`, 1px `{colors.primary}` border, `{rounded.pill}`, 11px × 22px. The second CTA when two pills pair ("Cancel" / "Publish").

**`button-pearl-capsule`** — Glass secondary. Background `{colors.glass-panel-bg}` (the chassis material), text `{colors.ink-muted-80}` in `{typography.caption}`, `{rounded.md}` (12px), 8px × 14px. Reads as a small glass tile rather than a flat button.

**`button-icon-circular`** — Floats over glass. 44 × 44px, background `{colors.surface-chip-translucent}` (`rgba(255,255,255,0.4)`) + specular highlight, icon `{colors.ink}`, `{rounded.full}`. Used for close, carousel, and in-panel controls.

**`text-link`** — Inline links in `{colors.primary}`. On dark/terminal surfaces use `{text-link-on-dark}` (`{colors.primary-on-dark}` #2997ff).

### Layout Components

**`CollapsiblePanel`** — `{glass-panel}` chassis with `transition-all duration-300`. Folds/expands the right rail. Divider via `{glass-divider}`.

**`ResizeHandle`** — The drag grip between panels. Rest: transparent; hover `{glass-bg-hover}`; active `{glass-bg-active}`. Transitions via `glass-transition` (0.2s smooth spring).

**`BranchPanel`** — Search box wrapped in `{glass-input}`; branch list with `glass-stagger` entrance, each row `glass-transition`; current branch rendered as `{glass-surface-selected}`. Auto-hiding `glass-scrollbar`.

**`RepositoryList`** — Each repo rendered as `{glass-surface}`; `glass-scrollbar` on the container.

**`SettingsDialog`** — Left nav as `{glass-surface}`; selected category `{glass-bg-active}`; kbd hints via `{glass-kbd}`; content region `glass-scrollbar`.

**`ShortcutsDialog`** — Shortcut rows with `glass-stagger` entrance; keys in `{glass-kbd}`.

### Business Components

**`EnvironmentCheckDialog`** — Per-tool status panels on `{glass-code-bg}` with `{glass-border-subtle}`; scrollable via `glass-scrollbar`.

**`ReleaseChecklistDialog`** — Step list with `glass-stagger` + `glass-press` + `glass-transition`; current step `{glass-surface-selected}`; `glass-scrollbar`.

**`CommandImportDialog`** — Result/error region on `{glass-input-bg}` with `destructive/8` for error states.

**`Parameter` editors** (`Boolean` / `String` / `Array` / `Map`) — Tooltip popovers on `{glass-panel-bg}` + `backdrop-blur-xl` + `{glass-border}` + `{glass-shadow}`.

### Inputs & Forms

**`search-input`** — Wrapped in `{glass-input}`. Background `{colors.glass-input-bg}`, text `{colors.ink}` in `{typography.body}`, `{rounded.md}` (12px — inputs match the surface grammar, not the pill grammar), height 44px, leading search glyph at 14px muted. On focus: primary ring via `{glass-input.focusWithin}`.

**`glass-input` focus** — `box-shadow: 0 0 0 3px hsl(var(--primary) / 0.12)` + border deepens to `{colors.glass-border}`. The ring uses `{spring.smooth}` at 0.2s — no overshoot on color/ring changes.

### Footer

**`footer`** — Background `{colors.canvas-parchment}` (#f5f5f7), text `{colors.ink-muted-80}`. Link columns in `{typography.dense-link}` (17px / 400 / 2.41 line-height — the relaxed leading is what makes the dense columns scannable). Column headings in `{typography.caption-strong}` (14px / 600). Legal row at the very bottom in `{typography.fine-print}` (12px / 400) with `{colors.ink-muted-48}` text. Vertical padding 64px.

## Do's and Don'ts

### Do
### Do
- Use `{colors.primary}` (Action Blue `hsl(220 72% 50%)`) for every interactive element — links, primary CTAs, focus rings, selected-state rings — and nothing else. The single accent is non-negotiable.
- Set headlines in `{typography.hero-display}` or `{typography.display-lg}` with negative letter-spacing (`-0.28 → -0.374px`) to get the signature "Apple tight" cadence.
- Run body copy at `{typography.body}` (17px / 400 / 1.47 / -0.374px) — not 16px. The extra pixel defines the brand's reading pace.
- Build depth through **layered translucency**: stack `{glass-panel}` (40px blur) → `{glass-card}` (24px) → `{glass-surface}` (20px) → `{glass-input}` (8px). The blur radius decreases as interaction proximity increases.
- Reserve `{rounded.pill}` for the primary blue CTA and switches' tracks. Everything else escalates by size: 12px (interactive) → 16px (container).
- Apply `{glass-shadow}` at rest, `{glass-shadow-lg}` on hover-lift, and `{glass-shadow-selected}` for the chosen state — three shadow tiers, used consistently.
- Use `transform: scale(0.97)` at `{spring.duration-press}` (0.1s) as the press state on every button, switch, and select trigger — it's the system-wide haptic micro-interaction.
- Add a `::before` specular highlight (`{colors.glass-specular}`) to `{glass-surface}` and `{glass-card}` so they read as polished glass, not flat plastic. Keep it `pointer-events: none`.
- Let every transform use `{spring.standard}` (`0.34, 1.56, 0.64, 1`) and every color/opacity change use `{spring.smooth}` (`0.2, 0.8, 0.2, 1`) — never linear, never ease-in-out.
- Apply `glass-stagger` to list entrances so children cascade in at 30ms increments (capped at 8 levels / 240ms).
- Respect `prefers-reduced-motion`: zero all durations and disable transforms when the user opts out.

### Don't
- Don't introduce a second accent color; every "click me / this is active" signal is `{colors.primary}` (Action Blue). In dark mode use `{colors.primary-focus}` (the brighter sibling), never a different hue.
- Don't use flat solid backgrounds for containers — the glass material (translucency + blur + specular) is the system. The only flat surface is the terminal panel (`{colors.surface-black}`).
- Don't use decorative gradients as backgrounds. The only gradient token is `{colors.glass-specular}`, a material light-sweep, not a color decoration.
- Don't set body copy at weight 500 — Apple's ladder is 300 / 400 / 600 / 700, with 500 deliberately absent. Body is always 400; strong inline is 600; display is 600.
- Don't tighten line-height below 1.47 for body copy — the editorial leading is part of the brand.
- Don't mix blur radii arbitrarily — the hierarchy is fixed: panel 40 > popover 32 > card 24 > surface 20 > overlay 12 > input 8.
- Don't apply shadows to the terminal panel or to text — shadows belong to glass surfaces and product imagery only.
- Don't use `{colors.primary-on-dark}` (Sky Link Blue #2997ff) on light glass — it's the dark-surface-only variant. Action Blue is for light surfaces.
- Don't animate colors/opacity with overshoot springs — use `{spring.smooth}` (no overshoot) for color/bg/border/shadow; reserve `{spring.standard}` (overshoot) for transforms only.
- Don't forget `glass-scrollbar` on every scrollable region — transparent at rest, `muted-foreground/0.3` on hover.

## Responsive Behavior

OnePublish is a **desktop application**, not a responsive web page. The window is resizable but the layout grammar is panel-based, not breakpoint-based. "Responsive" here means the panel system adapts to window size, not that components reflow into mobile stacks.

### Window Size Adaptation

| Window Width | Layout Behavior |
|---|---|
| ≥ 1280px | Full 3-region layout: left sidebar + center + right rail all visible |
| 960–1279px | Right rail collapses to `{CollapsiblePanel}` (toggle on demand); sidebar + center visible |
| 720–959px | Sidebar narrows to icon-only repo list; center takes priority; dialogs shrink to `sm` size variant |
| < 720px | Not a target form factor — OnePublish is desktop-first. Window enforces a minimum usable size. |

### Panel Behavior
- **Sidebar**: resizable via `{ResizeHandle}`; persists width in config. Min 200px, max 420px.
- **Right rail**: `{CollapsiblePanel}` — folds to a 0-width strip when not executing; expands on publish start.
- **Dialogs**: three size variants (`sm` / `md` / `lg`) chosen by content, not window size. `AppDialogShell` enforces consistent header/body/footer rhythm.

### Touch & Hit Targets
- Minimum 44 × 44px for all interactive elements — matches `{button-icon-circular}` and the primary CTA hit area.
- `{glass-press}` scale (0.97) makes the visible feedback area more generous than the label suggests.
- Resize handles are 6px wide with a 12px hover-expanded hit zone.

### Theme Adaptation
- **Light/Dark**: follows system preference (`prefers-color-scheme`), switchable in Settings. The entire glass material layer re-bakes (alphas invert, specular dims, shadows deepen) — see *Glass Material Layer (dark)* in Colors.
- **Reduced motion**: `prefers-reduced-motion: reduce` zeroes all animation/transition durations and disables transforms. The system degrades to instant state changes; glass translucency and color remain.

## Iteration Guide

1. Focus on ONE component at a time. Reference its YAML key directly (`{component.glass-card}`, `{component.glass-input}`).
2. Variants of an existing component (`-hover`, `-selected`, `-dark`, `-interactive`) live as separate entries in `components:`.
3. Use `{token.refs}` everywhere — never inline hex or rgba. The glass tokens are the single source of truth.
4. Document Default, Hover, and Active/Selected states. (Hover IS documented here — unlike the original Apple-web spec, glass surfaces have a meaningful hover-lift that must be specified.)
5. Display headlines stay SF Pro Display 600 with negative letter-spacing. Body stays SF Pro Text 400 at 17px. The boundary is unbreakable.
6. Every new surface picks a blur tier from the fixed hierarchy (panel 40 > popover 32 > card 24 > surface 20 > overlay 12 > input 8). Never invent a new blur radius.
7. Every new motion picks a spring from the fixed set (`{spring.standard}` for transforms, `{spring.smooth}` for colors). Never use linear or ease-in-out.
8. When in doubt about emphasis: increase translucency (→ `{glass-bg-active}`) or add `{glass-shadow-selected}` before adding chrome or color.

## Known Gaps

- Form validation and error states use the shadcn `destructive` token (`hsl(0 72% 51%)`) but are not yet formalized as a `{glass-input-error}` variant with a matching ring color. Current error ring is `destructive/0.12`.
- The terminal panel (`{colors.surface-black}`) uses a solid dark surface by design; a translucent "glass terminal" variant was prototyped but rejected for log legibility — log contrast wins over material consistency here.
- The `{glass-specular}` highlight is currently `none` in light mode (the warm canvas provides enough luminance) and only active in dark mode. A light-mode specular may be reintroduced if surfaces read too flat.
- Some glass tokens have CSS variable declarations (`--glass-*`) that differ slightly from the YAML values documented here (e.g. `--glass-bg` light is `rgba(255,253,250,0.62)` vs the doc's general `rgba(255,255,255,0.62)`). The CSS file is authoritative; this doc tracks intent.
- The `repo-sidebar-shell` uses a custom linear-gradient background (`--repo-sidebar-shell-bg`) that sits outside the glass token system — it's a branded chassis exception, documented in `src/index.css`.
- Backdrop-filter performance on very large blurred regions (full-window dialogs) can degrade on lower-end hardware; the blur hierarchy is tuned to keep the heaviest blur (40px) on small regions (sidebars) and lighter blurs on large regions (overlays at 12px).
