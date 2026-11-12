# Fawanees light: three directions (for review)

Status: **proposal, waiting for the owner's pick**. Nothing here changes the site yet. The theme files are untouched, and no environment's active theme changes. The header stays dark in every option.

Renders (home, watch, Studio videos, account menu, drawer; desktop and phone; en and ar) and the side-by-side comparison with today, Lantern light and Fawanees dark are on the review page: https://claude.ai/artifact/LHegZefDiNbujfz7N5PCYh

## What is wrong with Fawanees light today (fawanees@1.1.0)

- **Cards sink instead of lifting.** Cards, the rail and menus (`#f6d67f`, lightness 73%) are darker and more saturated than the page (`#fff1c4`, 88%). Page to card is only 1.26:1, and on a light theme darker reads as lower.
- **Gold everywhere, so gold means nothing.** Page, cards, rail, menus, dialogs, form fields, Studio filter chips, dividers and thumbnail placeholders (`gray-200` maps to `divider` `#d9b356`) are all gold. Primary gold is 1.35:1 from the card it sits on, so Upload, Watch now and Subscribe no longer stand out.
- **One hue, no temperature contrast.** Every light surface sits at hue 44–46° and 87–100% saturation. Dark mode works because gold is the light in a cool night-teal room; light mode has no cool counterweight apart from the header.
- **Hero and page gradients blend.** The page has a dark-gold band (`heroStart` `#efc65f`) plus 18–22% gold glows; the hero adds a 34% gold glow on the same gold.
- **Studio loses its states.** Chips, selects, search and the selected nav row are all gold-filled, so the active filter barely differs from inactive ones, and inputs look disabled.
- **Accent text is under AA**: 3.23–4.01:1 on the gold surfaces. The gate checks `accent` at 3:1 (nontext), but the web uses it as text in 26 places. This affects other themes too (#1068).

## Directions

- **A · Lamplit Ivory** (عاج مضاء). Warm ivory parchment page, white cards, ink text. Gold appears only where you act (primary buttons, the lantern indicator, progress) and as one soft lamp-glow in the hero.
- **B · Teal Lantern** (فانوس فيروزي). The dark mode's night teal, lightened: a misty teal page, near-white cards and a teal hero, with gold kept for actions and the lantern glow. Links are deep teal, so gold never carries text.
- **C · Sand & Cream** (رمل وقشدة). The warmest option and closest to today: a golden-sand page, cream cards that clearly sit above it, and a gold-dusk hero. Gold stays in the hero, the card's top hairline and actions, but never fills a whole surface.

## Light tokens

| Token | Today | A · Lamplit Ivory | B · Teal Lantern | C · Sand & Cream |
|---|---|---|---|---|
| Page background (`background`) | `#fff1c4` | `#f7f2e7` | `#e9f0ef` | `#efdcb2` |
| Surface (cards) (`surface`) | `#f6d67f` | `#fffdf8` | `#f9fbfa` | `#fdf7ea` |
| Surface raised (dialogs, fields) (`surfaceRaised`) | `#f9df97` | `#ffffff` | `#ffffff` | `#fffcf4` |
| Text (`textPrimary`) | `#0b2534` | `#0b2534` | `#0b2534` | `#0b2534` |
| Secondary text (`textSecondary`) | `#143a4c` | `#2b4452` | `#1f3d4a` | `#273e4b` |
| Muted text (`textMuted`) | `#24505f` | `#475c67` | `#3a5663` | `#3f5460` |
| Link (`link`) | `#6a4200` | `#7a4300` | `#0a5260` | `#6a3a00` |
| Primary (buttons) (`primary`) | `#f4ae3a` | `#f4ae3a` | `#f4ae3a` | `#f4ae3a` |
| On primary (`onPrimary`) | `#09151e` | `#09151e` | `#09151e` | `#09151e` |
| Accent (indicators, switches, progress) (`accent`) | `#a85600` | `#9a5200` | `#8a4800` | `#753c00` |
| Outline (UI borders) (`outline`) | `#7a6326` | `#7d6d55` | `#5d7a82` | `#735f3f` |
| Divider (`divider`) | `#d9b356` | `#e6dcc8` | `#cbdad8` | `#e0c995` |
| Menu / drawer bg (`menu.bg`) | `#f6d67f` | `#f7f2e7` | `#e9f0ef` | `#efdcb2` |
| Menu hover / drawer active (`menu.hover`) | `#efc65f` | `#f3e4c0` | `#cfe0de` | `#ecca7c` |
| Hero start (`heroStart`) | `#efc65f` | `#f3e4c0` | `#cfe0de` | `#ecca7c` |
| Hero end (`heroEnd`) | `#fff1c4` | `#f7f2e7` | `#e9f0ef` | `#efdcb2` |
| Header (unchanged, dark) (`nav.bg`) | `#0e2b3d` | `#0e2b3d` | `#0e2b3d` | `#0e2b3d` |

Menu and drawer use the page background in light mode, with a border and shadow (the nav-unification rule). Dark mode is unchanged in every direction.

## Light-only materials

These are the gradients and edges the renders use. Today they are shared by light and dark (`components.<part>.style` has no per-mode value). Building the chosen direction needs one of two things: a small format addition (a `light` override per style), or formulas that keep dark mode pixel-identical.

| Material (light only) | A | B | C |
|---|---|---|---|
| `--m-page` | `radial-gradient(34% 26% at 12% 0%,color-mix(in srgb,var(--fanous-color-primary) 10%,transparent),transparent 72%),linear-gradient(180deg,#f3ead8,var(--fanous-color-background) 320px)` | `radial-gradient(40% 30% at 88% 0%,color-mix(in srgb,var(--fanous-color-motif) 12%,transparent),transparent 72%),linear-gradient(180deg,#dde9e7,var(--fanous-color-background) 320px)` | `radial-gradient(36% 30% at 14% 0%,color-mix(in srgb,var(--fanous-color-primary) 22%,transparent),transparent 72%),radial-gradient(36% 30% at 86% 6%,color-mix(in srgb,var(--fanous-color-primary) 16%,transparent),transparent 72%),linear-gradient(180deg,#ebd29c,var(--fanous-color-background) 360px)` |
| `--m-hero` | `radial-gradient(46% 140% at 84% 0%,color-mix(in srgb,var(--fanous-color-primary) 30%,transparent),transparent 70%),linear-gradient(120deg,var(--fanous-color-surface-raised),var(--fanous-color-hero-start))` | `radial-gradient(42% 150% at 86% 0%,color-mix(in srgb,var(--fanous-color-primary) 34%,transparent),transparent 68%),linear-gradient(120deg,var(--fanous-color-surface-raised),var(--fanous-color-hero-start))` | `radial-gradient(55% 150% at 82% 0%,color-mix(in srgb,var(--fanous-color-primary-hover) 55%,transparent),transparent 70%),linear-gradient(120deg,var(--fanous-color-surface),var(--fanous-color-hero-start))` |
| `--m-card` | `linear-gradient(var(--fanous-color-surface),var(--fanous-color-surface))` | `linear-gradient(var(--fanous-color-surface),var(--fanous-color-surface))` | `radial-gradient(80% 50% at 50% 0%,color-mix(in srgb,var(--fanous-color-primary) 5%,transparent),transparent 70%),linear-gradient(var(--fanous-color-surface),var(--fanous-color-surface))` |
| `--m-border` | `linear-gradient(var(--fanous-color-divider),var(--fanous-color-divider))` | `linear-gradient(var(--fanous-color-divider),var(--fanous-color-divider))` | `linear-gradient(180deg,var(--fanous-color-primary),var(--fanous-color-divider) 45%)` |
| `--m-card-edge` | `0 1px 2px rgb(11 37 52/.06),0 10px 24px -18px rgb(11 37 52/.28)` | `0 1px 2px rgb(11 37 52/.06),0 10px 24px -18px rgb(11 37 52/.3)` | `0 1px 2px rgb(60 40 10/.08),0 12px 26px -18px rgb(60 40 10/.35)` |
| `--m-raised` | `linear-gradient(var(--fanous-color-background),var(--fanous-color-background))` | `linear-gradient(var(--fanous-color-background),var(--fanous-color-background))` | `linear-gradient(var(--fanous-color-background),var(--fanous-color-background))` |
| `--m-raised-edge` | `0 0 0 1px var(--fanous-color-outline),0 18px 40px -18px rgb(11 37 52/.35)` | `0 0 0 1px var(--fanous-color-outline),0 18px 40px -18px rgb(11 37 52/.35)` | `0 0 0 1px var(--fanous-color-outline),0 18px 40px -18px rgb(60 40 10/.4)` |
| `--m-rail` | `var(--fanous-color-background)` | `var(--fanous-color-background)` | `var(--fanous-color-background)` |
| `--m-hover` | `color-mix(in srgb,var(--fanous-color-hero-start) 70%,transparent)` | `color-mix(in srgb,var(--fanous-color-hero-start) 70%,transparent)` | `color-mix(in srgb,var(--fanous-color-hero-start) 55%,transparent)` |
| `--m-active` | `linear-gradient(var(--to-end),color-mix(in srgb,var(--fanous-color-primary) 26%,transparent),transparent 92%)` | `linear-gradient(var(--to-end),color-mix(in srgb,var(--fanous-color-primary) 30%,transparent),transparent 92%)` | `linear-gradient(var(--to-end),color-mix(in srgb,var(--fanous-color-primary) 34%,transparent),transparent 92%)` |
| `--m-thumb-edge` | `0 0 0 1px rgb(11 37 52/.08)` | `0 0 0 1px rgb(11 37 52/.1)` | `0 0 0 1px rgb(60 40 10/.12)` |

## Contrast

| | Today | A | B | C |
|---|---|---|---|---|
| Lowest text pair (needs 4.5) | 3.23:1 (accent on heroStart) | 4.66:1 (accent on heroStart) | 5.11:1 (accent on heroStart) | 5.02:1 (textMuted on heroStart) |
| Lowest UI pair (needs 3) | 3.55:1 (outline on menuHover) | 3.98:1 (outline on menuHover) | 3.36:1 (outline on menuHover) | 3.87:1 (outline on menuHover) |
| Pairs under AA | 6 | 0 | 0 | 0 |
| Package validator (`validatePackage`, built-in rules) | pass | pass | pass | pass |
| Rendered text, pixel probe, lowest across 20 renders | 5.56:1, 0 under 4.5 | 6.28:1, 0 under 4.5 | 6.54:1, 0 under 4.5 | 5.87:1, 0 under 4.5 |

How it was measured:

- **Token pairs.** Every text colour (text, secondary, muted, link and accent, with accent treated as text) on every surface it can sit on: page, card, raised, hero start, menu, menu hover and drawer active. Plus on-primary on primary, and every component pair in `BASE.componentPairs`.
- **UI pairs (3:1).** Outline, primary edge and focus ring.
- **Package validator.** `validatePackage` with the built-in rules.
- **Pixel probe.** The Theme visibility harness's `measureText` on each of the 20 renders per variant. It compares every visible text with the pixels behind it, gradients included.

## Machine-readable values

`fawanees-light-directions.json` holds each direction's light colour overrides, its light component overrides and its light-only materials, exactly as rendered.
