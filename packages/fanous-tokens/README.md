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
