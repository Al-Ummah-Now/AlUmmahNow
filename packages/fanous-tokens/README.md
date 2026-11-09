# @al-ummah/fanous-tokens

Design tokens for Fanous, the Al Ummah Now design system.
Shared scales and colour roles are in `tokens/fanous.tokens.json`. Each theme is data in `themes/<id>/theme.json`, listed in
`themes/registry.json`. See `docs/design/THEMES.md`.

```bash
pnpm tokens:generate   # rewrite generated/
pnpm check:tokens      # CI gate: slots, assets, WCAG AA, logo hues, generated/ is current
pnpm test:tokens       # unit and snapshot tests
```

No dependencies: it runs on Node 22.

## Generated outputs

| Platform | Files under `generated/<theme>/` | How to consume |
|---|---|---|
| SwiftUI | `swift/` | Add as a local Swift package, use `Fanous.dark` / `Fanous.light` |
| Jetpack Compose | `kotlin/.../FanousTokens.kt` | Copy into a module, wrap with `FanousTheme { }`, read `LocalFanousColors.current` |
| WinUI 3 | `winui/Fanous.Colors.xaml`, `Fanous.Tokens.xaml` | Merge into `Application.Resources` |
| GTK 4 / libadwaita | `gtk/style.css`, `style-dark.css` | Bundle in the app's GResource base path, `AdwApplication` loads them |
| Tizen NUI | `tizen/FanousTokens.cs` | Add to the C# project |
| Web | `web/tokens.css`, `tailwind-preset.cjs`, `brand.cjs` | Import the CSS, set `data-fanous-theme="light"` for light |

## Native theme registry

The native apps follow the site theme an admin sets (`site.theme`, read from `GET /public/site-theme` on
admin-api), so they carry every theme and switch at run time. `generated/native/` holds one registry per
platform with all themes, both modes, every component part, the materials and the player chrome:

| Platform | File | Used by |
|---|---|---|
| SwiftUI | `native/swift/FanousThemes.swift` | AlUmmahNowApple, `AUNDesign` |
| Jetpack Compose | `native/kotlin/net/alummahnow/fanous/FanousThemes.kt` | AlUmmahNowAndroid, `:design` |
| C# (netstandard2.0) | `native/csharp/FanousThemes.cs` | AlUmmahNowDesktop: WinUI 3, GTK 4, Tizen NUI |
| GTK 4 CSS | `native/gtk/<theme>.css`, `<theme>-dark.css` | AlUmmahNowDesktop Linux (`aun-*` classes) |
| Motifs | `native/svg/<theme>/<mode>/*.svg`, `native/android/drawable/fanous_<theme>_<asset>_<mode>.xml` | all |

`native/registry.json` lists the themes and the fallback, Fawanees, which an app shows when it cannot read the
site theme and has none cached. The apps vendor these files at a pinned commit and check them in CI.

Each theme's depth lives next to its colours:

- `themes/<id>/material.json`: radii, backdrop blur and the material of each surface (page wash, header,
  rail, card and border, raised, control, primary, active, hover, selection, hero, thumbnail edge, player
  ring), written as CSS values over the theme's colours (`var(--fanous-color-*)`, `var(--fanous-c-*)`).
- `themes/<id>/player.json`: the player chrome (#472).

`src/css-value.ts` evaluates those values for each mode into colours, gradient stops and shadow lists. A fade to
`transparent` keeps its neighbour's hue, because CSS interpolates premultiplied and native gradients do not.
Logical directions (`var(--to-end)`, `at var(--from)`) stay logical and mirror in right-to-left layouts.

## Adding a colour

Every entry in `color.theme.*` needs `$extensions.fanous.role`, and the checker uses it to build the pairs:

| Role | Checked against | Minimum |
|---|---|---|
| `text` | every `surface` | 4.5:1 |
| `on` | the fill named in `on` | 4.5:1 |
| `nontext` | every `surface` | 3:1 |
| `surface`, `fill` | used as backgrounds. A `fill` needs an `on` colour. | |
| `decorative` | not checked. Separators only. | |

## Fonts (decision D6)

`font.pair` offers `plexSans` and `notoKufiInter`. `font.family` points at `system` until the owner
chooses. To choose, point both `font.family` aliases at the pair and regenerate. Font files are not
bundled here.
