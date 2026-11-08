# Epic 10 plan: Fanous design system

Spec: [EPICS.md](./EPICS.md) §3 and Epic 10. This plan covers what ships now, what waits on the
owner, and what is left for the platform epics.

## Scope by story

| Story | This work | Status after this work |
|---|---|---|
| 10.1 Tokens | `packages/fanous-tokens`: one W3C-format JSON source, generators for SwiftUI, Compose, WinUI 3, GTK 4/libadwaita, Tizen NUI and web. Snapshot tests, AA contrast gate, CI. | Done |
| 10.2 Typography | Latin and Arabic scales, both open-licensed pairs as options, Eastern Arabic numeral option. | Done except the choice (D6) |
| 10.3 Components | None. Components are built on the tokens, per platform, in the app epics (12, 15, 16). | Not started |
| 10.4 10-foot | Tokens only: 48dp targets, safe area, focus glow, focus scale. | Tokens done, components not started |
| 10.5 Iconography | Requirements doc: [`docs/native-apps/fanous/ICONOGRAPHY.md`](./fanous/ICONOGRAPHY.md). | Needs a designer |
| 10.6 App icons, store art | Spec and machine-readable size matrix. Icons are not generated (see below). | Needs a designer |
| 10.7 Catalogues | None. Depends on 10.3. | Not started |

## Design decisions

- **Zero runtime dependencies.** Generators are TypeScript run by Node 22 type stripping, like
  `scripts/release/`, so the check runs in `release-checks` with no install.
- **Generated files are committed** under `packages/fanous-tokens/generated/`. Native projects consume
  them with no Node toolchain. They double as the snapshots: CI regenerates and fails on any difference.
- **Brand values are kept exactly as the spec lists them**, as primitives (`color.brand.*`). The
  semantic aliases (`color.theme.dark.*`, `color.theme.light.*`) are what apps use.
- **Every themed colour declares a contrast role.** The checker crosses all text roles with all
  surfaces, so a new token is checked automatically and a token with no role fails the build.
- **W3C format:** `$value`/`$type`/`$description`, `{alias}` references, hex colours and `px` strings
  (the form tools support today).

## Where the spec palette needed derived values

Measured with the WCAG 2.1 formula. Brand values are unchanged; these roles use a derived colour.

| Spec use | Pair | Ratio | Resolution |
|---|---|---|---|
| Lantern for focus and progress, light theme | `#ffa037` on `#f7f1e8` | 1.81 | `lanternDeep` `#a85600` for focus, accent. `lanternInk` `#9a4f00` for links. Lantern stays as the light primary button fill, with night text (6.84). |
| Verified as text, dark | `#16a34a` on `#093041` | 4.22 | `verifiedBright` `#4ade80` |
| Verified, light | `#16a34a` on `#f7f1e8` | 2.94 | `verifiedDeep` `#166534` |
| White on verified fill | `#ffffff` on `#16a34a` | 3.30 | Fill uses `verifiedDeep` (7.13) |
| Error as text, dark | `#b00020` on `#093041` | 1.90 | `errorBright` `#ff9c94` |
| Earth as a non-text indicator on dark | `#8e6c53` on `#093041` | 2.93 | Earth stays a labelled button fill with white text (4.75). Outlines use `outline`. |

## Owner decisions

- **D6 fonts:** the tokens carry `plexSans` (IBM Plex Sans Arabic + IBM Plex Sans) and `notoKufiInter`
  (Noto Kufi Arabic + Inter), both under the SIL Open Font License 1.1. The active pair is `system`
  until the owner chooses. Choosing is a one-line change to the `font.family` aliases. The web app
  keeps Farsi Simple Bold until then.
- **D8 naming:** "Fanous" is used for the package and token prefix. Renaming is a generator-level change.
- **Light-theme accent:** confirm the derived colours above are acceptable, since the spec named
  lantern for focus rings.

## Rollout

1. Plan, package, generators, tests, CI.
2. Iconography and app-icon specs.
3. Web wiring with no visual change: tokens import inert `--fanous-*` variables, and only values
   that are already identical are sourced from the tokens.
