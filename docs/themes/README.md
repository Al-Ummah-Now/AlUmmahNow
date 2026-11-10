# Theme packages

A theme is a **package**: a folder with one `theme.json` and an `assets/` folder for the images and
fonts it uses. The package holds the whole design of every component and page: colours, gradients,
borders, shadows, radii, type and imagery. It is not a palette. An app compiles the package to CSS
and renders from that CSS, so a theme needs no hand-written per-theme stylesheet.

Format version: **1**. Schema: [`theme-package.v1.schema.json`](./theme-package.v1.schema.json)
(JSON Schema 2020-12). The library that validates and compiles packages is
`packages/theme-packages` (`@al-ummah/theme-packages`).

Any app may adopt this format. The videos platform uses it for the videos site and the theme
builder in the videos admin. Auth keeps its own themes, managed in the Auth admin, in the same
format. The two apps do not share theme storage or settings.

## Folder

```text
fawanees/
  theme.json            the package (this document)
  assets/
    pattern.svg         any images the package names
    logo.png
    fonts/Amiri-700.woff2
```

As a file, the package is a `.zip` of that folder: either `theme.json` at the root of the zip, or
one top-level folder that holds it. Exports always use the folder form (`<id>/theme.json`).

Rules for `assets/`:

- Paths in `theme.json` are relative to the package root and start with `assets/`. No `..`, no
  absolute paths, no URLs.
- Allowed files: `.svg`, `.png`, `.jpg`/`.jpeg`, `.webp`, `.ico`, and `.woff2` under `assets/fonts/`.
  The bytes must match the extension.
- At most 2 MB per file and 12 MB per package.
- SVGs must not contain scripts, event handlers, `<foreignObject>`, entities or external
  references (`href`/`src`/`url()` to anything but `#id`).

## theme.json

```jsonc
{
  "$schema": "../../theme-package.v1.schema.json",   // optional, for editors
  "format": "alummahnow.theme-package",
  "formatVersion": 1,
  "id": "fawanees",                                  // ^[a-z][a-z0-9-]{1,39}$
  "version": "1.0.0",                                // the package's own semver
  "name": { "en": "Fawanees", "ar": "فوانيس" },
  "author": "Al Ummah Now",
  "kind": "event",                                   // base | look | event | rebrand | custom
  "basedOn": "lantern@1.0.0",                        // optional, informational
  "tokens": { ... },
  "materials": { ... },
  "components": { ... },
  "typography": { ... },
  "imagery": { ... },
  "signIn": { ... },                                 // optional
  "profile": { ... },                                // optional
  "browser": { ... }, "email": { ... }, "banner": { ... }   // optional
}
```

A package is **standalone**. Nothing is inherited at runtime: a package made by duplicating another
copies every value and every asset. `basedOn` only records where it came from.

Keys that start with `x-` are extension data. Consumers ignore keys they do not know there; any
other unknown key is an error.

### Values

| Kind | Form | Example |
|---|---|---|
| Colour slot | `#rrggbb` (lowercase, opaque), or a reference to a role or brand colour | `"#f4ae3a"`, `"{color.surface}"`, `"{brand.night}"` |
| Length | number with `px`, `rem`, `em` or `%`, or `0` | `"14px"` |
| CSS value | one CSS value with references | `"linear-gradient(180deg,{color.primaryHover},{color.primary} 56%)"` |
| Asset | a path under `assets/` | `"assets/pattern.svg"` |

References inside CSS values:

| Reference | Means | Compiles to |
|---|---|---|
| `{color.<role>}` | a colour role in the current mode | `var(--fanous-color-<role>)` |
| `{brand.<name>}` | a brand colour | `var(--fanous-brand-<name>)` |
| `{component.<part>}` | a component colour, e.g. `{component.nav.bg}` | `var(--fanous-c-nav-bg)` |
| `{material.<name>}` | another material, e.g. `{material.glow}` | `var(--m-glow)` |
| `{radius.<sm\|md\|lg\|xl\|pill>}` | a material radius | `var(--r-md)` |
| `{spacing.<step>}` | a spacing step | `var(--fanous-spacing-<step>)` |
| `{asset:assets/<file>}` | an image in the package | `url("<served URL>")` |

A CSS value may not contain `;`, `{`, `}` (except in references), `<`, `>`, `\`, `@`, `url(`,
`expression(` or `javascript:`, and may not read `--fanous-*`, `--m-*` or `--r-*` with `var()`
directly (use a reference, so the validator can check it). `var()` is allowed for layout variables a
component sets, such as `var(--from)` and `var(--to-end)` (the reading-direction start and end).

Literal colours (`#…`, `rgb()`, `color-mix()` with literals) belong in packages. Component CSS in the
apps reads tokens only; `pnpm check:theme-colors` keeps it that way.

### tokens

| Field | Type | Notes |
|---|---|---|
| `brand` | `night`, `nightDeep`, `nightShallow`, `lantern`, `glow`, `earth`, `parchment`, `verified`, `error` → `#rrggbb` | Named brand colours. |
| `color.light`, `color.dark` | every colour role → colour slot | All 36 roles in both modes: `background`, `surface`, `surfaceRaised`, `heroStart`, `heroEnd`, `textPrimary`, `textSecondary`, `textMuted`, `link`, `successText`, `errorText`, `primary`, `onPrimary`, `primaryHover`, `onPrimaryHover`, `primaryPressed`, `onPrimaryPressed`, `primaryDisabled`, `onPrimaryDisabled`, `primaryEdge`, `primarySheen`, `motif`, `secondary`, `onSecondary`, `verifiedFill`, `onVerifiedFill`, `errorFill`, `onErrorFill`, `live`, `onLive`, `accent`, `focusRing`, `focusGlow`, `verifiedIcon`, `outline`, `divider`. |
| `radius` | `none`, `sm`, `md`, `lg`, `xl`, `full` → px | The token radius scale. |
| `elevation` | `low`, `medium`, `high` → `{ color: #rrggbbaa, offsetX, offsetY, blur, spread }` (px) | Shadows. |
| `borderStyle` | `solid` \| `double` \| `dashed` \| `none` | Optional. |
| `spacing` | step → px number | Optional overrides of the platform spacing scale. |

Type sizes, motion, focus widths, TV and layout metrics are platform-wide and are not part of a
package: layout is the same in every theme.

### materials

Shared material values that every component draws from.

| Field | CSS property | Meaning |
|---|---|---|
| `radius.sm` … `radius.pill` | `--r-sm` … `--r-pill` | Corner radii used by components. |
| `glow` | `--m-glow` | The theme's light: used in shadows and halos. |
| `blur` | `--m-blur` | Backdrop filter for translucent surfaces (`none` for opaque themes). |
| `hover` | `--m-hover` | Hover wash on rows, chips and icon buttons. |

### components

Each component section has some of:

- `colors.light` / `colors.dark`: every colour part of that component (colour slots).
- `style`: material fields (CSS values): gradients, borders, shadows, shapes.
- `chrome` (player only): the player controls.

Every listed part and field is required, so a package always describes the whole design.

| Section | Colour parts | Style fields | Styles |
|---|---|---|---|
| `page` | — | `background` | The page canvas behind everything. |
| `header` | `nav.*` | `background`, `edge` | Top bar: logo, search, account. |
| `drawer` | `drawer.*` | — | Phone navigation drawer. |
| `sidebar` | — | `background`, `edge`, `active`, `activeEdge`, `selection`, `selectionEdge`, `selectionBar`, `selectionGlow`, `indicator`, `indicatorWidth`, `indicatorHeight`, `indicatorShadow`, `indicatorShape` | Side rail and phone tab bar: the rail surface, the selected item and its indicator. |
| `buttonPrimary` | `button.primary.*` | `background`, `hover`, `pressed`, `edge` | Primary buttons (Subscribe, Save). |
| `buttonSecondary` | `button.secondary.*` | — | Secondary buttons. |
| `buttonGhost` | `button.ghost.*` | — | Ghost buttons. |
| `buttonDestructive` | `button.destructive.*` | — | Destructive buttons. |
| `buttonIcon` | `button.icon.*` | — | Icon buttons. |
| `upload` | `upload.*` | — | The header Upload action. |
| `input` | `form.*` | `background`, `edge` | Inputs, selects, switches, checkboxes and form sections. |
| `card` | — | `background`, `border`, `edge` | Every card surface: settings rows, pills and action buttons, shelves. |
| `videoCard` | `card.video.*` | `thumbnailEdge` | Video cards in grids and shelves. |
| `channelCard` | `card.channel.*` | — | Channel cards. |
| `hero` | — | `background` | Home hero, channel header and profile cover. |
| `tabs` | `tabs.*` | — | Tabs. |
| `segment` | `segment.*` | — | Segmented controls and filter chips. |
| `menu` | `menu.*` | `background`, `edge` | Menus and popovers; the style is the raised surface, which dialogs share. |
| `dialog` | `dialog.*` | — | Dialogs. |
| `toast` | `toast.*` | — | Toasts. |
| `badge` | `badge.*` | — | Live, duration and status badges. |
| `player` | `player.*` | `frame`, `inner`, `ring` | The frame around the video; `chrome` holds the controls. |
| `footer` | `footer.*` | — | Footer. |
| `link` | `link.*` | — | Text links. |
| `divider` | `divider.*` | — | Divider lines. |
| `skeleton` | `skeleton.*` | — | Loading skeletons. |
| `empty` | `empty.*` | — | Empty states. |

Colour parts per group (the schema lists them under `$defs/parts.<group>`):

| Group | Parts |
|---|---|
| `nav` | `bg`, `border`, `text`, `icon`, `hover`, `activeBg`, `activeText`, `indicator`, `searchBg`, `searchBorder`, `searchText`, `searchPlaceholder`, `menuBg`, `menuText`, `menuHover` |
| `drawer` | `bg`, `text`, `icon`, `activeBg`, `activeText`, `divider` |
| `button.*` | `bg`, `text`, `border`, `hover`, `pressed`, `focus`, `disabledBg`, `disabledText` |
| `upload` | the button parts and `icon` |
| `form` | `sectionBg`, `sectionBorder`, `label`, `help`, `inputBg`, `inputBorder`, `inputText`, `placeholder`, `focusRing`, `error`, `success`, `checkOn`, `checkMark`, `switchOn`, `switchOff`, `switchThumb` |
| `card.video` | `bg`, `title`, `meta`, `hover` |
| `card.channel` | `bg`, `name`, `meta` |
| `tabs` | `bg`, `text`, `activeText`, `indicator`, `border` |
| `segment` | `bg`, `text`, `activeBg`, `activeText` |
| `menu` | `bg`, `text`, `muted`, `hover`, `border` |
| `dialog` | `bg`, `text`, `muted`, `border` |
| `toast` | `bg`, `text`, `success`, `error`, `border` |
| `badge` | `liveBg`, `liveText`, `durationBg`, `durationText`, `statusBg`, `statusText` |
| `player` | `control`, `controlBg`, `progress`, `buffered`, `track` |
| `footer` | `bg`, `text`, `link`, `border` |
| `link` | `text` |
| `divider` | `line` |
| `skeleton` | `bg`, `shine` |
| `empty` | `title`, `body`, `icon` |

Style fields compile to these properties, which the apps' component CSS reads:

| Field | Property | Field | Property |
|---|---|---|---|
| `page.background` | `--m-page` | `buttonPrimary.background` | `--m-primary` |
| `header.background` | `--m-header` | `buttonPrimary.hover` | `--m-primary-hover` |
| `header.edge` | `--m-header-edge` | `buttonPrimary.pressed` | `--m-primary-press` |
| `sidebar.background` | `--m-rail` | `buttonPrimary.edge` | `--m-primary-edge` |
| `sidebar.edge` | `--m-rail-edge` | `input.background` | `--m-control` |
| `sidebar.active` | `--m-active` | `input.edge` | `--m-control-edge` |
| `sidebar.activeEdge` | `--m-active-edge` | `card.background` | `--m-card` |
| `sidebar.selection` | `--m-sel` | `card.border` | `--m-border` (a gradient painted as the border) |
| `sidebar.selectionEdge` | `--m-sel-edge` | `card.edge` | `--m-card-edge` |
| `sidebar.selectionBar` | `--m-sel-bar` | `menu.background` | `--m-raised` |
| `sidebar.selectionGlow` | `--m-sel-glow` | `menu.edge` | `--m-raised-edge` |
| `sidebar.indicator` | `--m-ind` | `hero.background` | `--m-hero` |
| `sidebar.indicatorWidth` | `--m-ind-w` | `videoCard.thumbnailEdge` | `--m-thumb-edge` |
| `sidebar.indicatorHeight` | `--m-ind-h` | `player.frame` | `--m-player` |
| `sidebar.indicatorShadow` | `--m-ind-shadow` | `player.inner` | `--m-player-inner` |
| `sidebar.indicatorShape` | `--m-ind-shape` (a `path()` or `inset()`) | `player.ring` | `--m-player-ring` |

`components.player.chrome` sets the player controls. One value serves both modes, because the
controls sit over video. Fields: `bar`, `bar-edge`, `bar-pad`, `bar-inset`, `bar-radius`, `blur`,
`icon`, `dim`, `track`, `track-edge`, `buffered`, `played`, `glow`, `handle`, `handle-edge`,
`hover`, `press`, `shape`, `tip-bg`, `tip-text`, `tip-edge`, `menu`, `menu-edge`, `menu-hover`,
`menu-selected`, `accent`, `big`, `big-icon`, `big-edge`, `spin`, `pill`, `pill-edge`, `cue`, `err`,
`scrim`, `live`, `live-text`. Each compiles to `--fanous-player-<field>`.

### typography

| Field | Notes |
|---|---|
| `latin`, `arabic` | Font family stacks for the tokens (`--fanous-font-latin`, `--fanous-font-arabic`). |
| `pair` | Optional: the platform font pair the stacks came from (`system`, `plexSans`, `notoKufiInter`, `sourceSerifAmiri`). |
| `body` | Optional `{ latin, arabic }`: page text uses these stacks instead of the app font; `arabic` applies on `lang="ar"` pages. |
| `faces` | Optional `[{ family, weight, style, src: "assets/fonts/x.woff2" }]` for fonts the platform does not ship. The platform ships Amiri, Inter, Noto Kufi Arabic and Source Serif 4. |

### imagery

Image slots, each a path under `assets/`: `pattern` (SVG or `"none"`), `loader` (SVG),
`logo.light|dark`, `wordmark.light|dark`, `favicon` (ICO), `icon192`, `icon512`, `iconMaskable512`,
`appleTouchIcon`, `ogImage`, `headerGraphic.light|dark` (SVG), `backdrop`, `ornament` (SVG), `hero`.
Any style field can also place an image with `{asset:assets/<file>}`, for example a page backdrop or
an ornament in a hero gradient.

### signIn and profile

Optional. They describe the sign-in and profile pages for the app that renders them: `signIn` has
`background.light|dark`, `graphic` (SVG), `graphicVars.light|dark` (custom properties the graphic
reads), and `card` (`background`, `edge`, `radius`); `profile` has `cover`. The videos site does not
render sign-in or profile pages and ignores both sections.

### browser, email, banner

Optional, as in the platform themes: `browser.themeColor.light|dark` and `browser.manifest`;
`email` (`headerImage`, `background`, `text`, `buttonBackground`, `buttonText`, `buttonRadius`);
`banner` (`enabled`, `text.en|ar`, at most 90 characters each).

## Validation

A package is valid when:

1. `theme.json` matches the schema.
2. Every reference names something that exists: a colour role, brand colour, component part,
   material, radius or spacing step, and every `assets/…` path is a file in the package.
3. Colour references resolve without a loop.
4. Every asset passes the rules under [Folder](#folder).
5. Contrast meets WCAG 2.1 AA in both modes: each text role against every surface role (4.5:1),
   each non-text role against every surface (3:1), each `on…` role against its fill (4.5:1), and
   each component text/background pair (`nav.text` on `nav.bg`, `button.primary.text` on
   `button.primary.bg`, …) at its listed minimum. Built-in packages also keep text on the primary
   action at 7:1.

Unused asset files are a warning, not an error.

## Compiling

`compilePackage(theme, options)` returns CSS scoped to `html[data-theme='<id>']`:

- design tokens: `--fanous-brand-*`, `--fanous-font-*`, `--fanous-radius-*`,
  `--fanous-elevation-*`, the platform scales, and per mode (`.dark` / `:not(.dark)`) every
  `--fanous-color-*` and `--fanous-c-*`;
- materials: `--r-*` and `--m-*`;
- body fonts and `@font-face` rules for bundled fonts;
- player chrome: `--fanous-player-*`.

Asset references become `url()`s through the caller's `assetUrl(path)`, so the same package can be
served from a build, a CDN or an admin API. The apps' component CSS reads only these properties.

## Versions

- `formatVersion` changes only for a breaking change to this document. Adding an optional field is
  not breaking and keeps version 1. A consumer refuses a `formatVersion` it does not know.
- `version` is the package's own semantic version. A published version never changes; editing a
  published theme makes a new version.

## Built-in themes

The platform themes are packages in `packages/theme-packages/themes/<id>/` (listed in
`themes/index.json`): Lantern, Zujaj, Nahas and Fawanees (the default). `pnpm themes:build` compiles
them into the stylesheets the videos site imports, and `pnpm themes:check` fails CI when a package
is invalid or a stylesheet is stale.
