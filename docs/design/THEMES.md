# Themes

A theme is a full skin for every Al Ummah Now app: a rebrand, a Ramadan or Eid event look, or another
look to switch to. It changes look and assets only. Layout, features and content structure are the
same in every theme.

Status: spec, 2026-11-08. Lantern is the first theme and the one deployed.

> **Videos site, 2026-11-09:** the web themes are now theme packages (`docs/themes/README.md`):
> `packages/theme-packages/themes/<id>/` compiles to the stylesheets the site imports, and the site
> theme switches at runtime from the admin. The fanous-tokens themes below remain the source for
> the native platforms; a test keeps the two equal.

## Decisions

| Topic | Decision |
|---|---|
| When a theme changes | With a deploy. One config value per app and environment: `ACTIVE_THEME`. |
| User choice of theme | None. No picker, no per-user preference, no profile sync. |
| Date-based switching | None. An event theme goes live and comes down through a deploy. |
| Light and dark | Every surface supports both, in every theme, unless listed under exceptions. Mode follows the system preference, and an existing toggle stays. |
| What ships | Only the active theme's CSS and assets, resolved at build time. |
| Page code | Refers to semantic tokens and named slots, never to a theme's files. |

## Theme model

**Every theme derives from the logo.** Its colours stay in the logo's teal and navy or ember and gold
hues, and its motifs and sign-in graphic come from the lantern's own shapes. CI fails a colour outside
those hues. The status green and red are shared meanings and are exempt.

Each theme is a folder of data in `packages/fanous-tokens/themes/<id>/`, listed in
`themes/registry.json`. Adding a theme means adding data and passing CI. No page or app code changes.

```text
themes/
  registry.json        ids of every registered theme
  lantern/
    theme.json         metadata, colours, type, shape, slot references
    assets/            files named by theme.json
```

The shared scales stay global: spacing, type sizes, the motion scale, focus widths and TV metrics.
`data-fanous-theme` keeps its current meaning, which is the **mode** (`light` or `dark`). There is no
runtime attribute for the theme, because a build contains only one.

### Parents and standalone themes

A theme may declare one parent with `extends`. The parent can be any registered theme.

- **With a parent:** a slot the theme leaves out resolves through the chain, from theme to parent to
  grandparent. Resolution happens at build time, so the output is flat and fully resolved.
- **With no parent:** the theme is standalone and defines every required slot itself, in both modes
  wherever the slot has modes. Lantern is standalone. A full rebrand should normally be standalone so
  nothing of the old brand leaks through.

Colours resolve per token and per mode. A theme with a parent can override `dark.background` alone.

Standalone rebrand:

```json
{
  "id": "newbrand",
  "kind": "rebrand",
  "name": { "en": "New Brand", "ar": "العلامة الجديدة" },
  "color": { "light": { "...every semantic colour": "#000000" }, "dark": { "...every semantic colour": "#000000" } },
  "font": "notoKufiInter",
  "shape": { "radius": { "...": "4px" }, "elevation": { "...": "..." }, "borderStyle": "solid" },
  "motif": { "pattern": "assets/pattern.svg", "loader": "assets/loader.svg" },
  "auth": { "headerGraphic": { "light": "assets/auth-header.light.svg", "dark": "assets/auth-header.dark.svg" } },
  "asset": { "...every required asset slot": "assets/file.png" },
  "email": { "...every required email slot": "..." }
}
```

Ramadan theme layered on Lantern:

```json
{
  "id": "ramadan",
  "kind": "event",
  "extends": "lantern",
  "name": { "en": "Ramadan", "ar": "رمضان" },
  "color": {
    "dark": { "background": "#1e1640", "surface": "#2a2055" },
    "light": { "background": "#f4f1fb", "surface": "#fcfbff" }
  },
  "motif": { "pattern": "assets/crescent-stars.svg" },
  "banner": {
    "enabled": true,
    "text": { "en": "Ramadan Mubarak", "ar": "رمضان مبارك" }
  }
}
```

Everything else in `ramadan` comes from Lantern. Its fonts, logo and emails are Lantern's.

### Slots

| Group | Slot | Required | Modes | Rule |
|---|---|---|---|---|
| Colour | every semantic colour, including the primary action scale | yes | light, dark | passes the contrast suite |
| Colour | `brandColor` primitives | yes | | hex |
| Type | `font`, the name of a pair in the shared tokens | yes | | Every pair sets Arabic and Latin. Files are self-hosted WOFF2 with a licence allowing it. |
| Shape | radius scale, elevation, border style | yes | | |
| Motif | `pattern`, `loader` | yes | | SVG with no scripts or external references. `pattern` may be `none`. |
| Brand | `wordmark`, `logo` | yes | light, dark | SVG, or PNG with alpha |
| Brand | `favicon` | yes | | ICO containing 16, 32 and 48 |
| Brand | `icon192`, `icon512`, `iconMaskable512` | yes | | PNG, exact size |
| Brand | `appleTouchIcon` | yes | | PNG, 180x180, no alpha |
| Brand | `ogImage` | yes | | PNG or JPEG, 1200x630, at most 1 MB |
| Browser | `themeColor`, manifest `background_color`, `theme_color` | yes | light, dark for `themeColor` | hex |
| Auth | `auth.background` | yes | light, dark | one or more images, or `color:<token>` |
| Auth | `auth.headerGraphic` | yes | light, dark | The sign-in card graphic. Hand-built SVG, decorative, drawn from the logo, and correct in RTL. Colours come from `--fanous-color-*`. A theme with a parent may inherit it. |
| Email | header image, colours, button style | yes | | PNG header at an absolute URL. System fonts only, because mail clients drop web fonts. |
| Optional | `heroIllustration`, `emptyIllustration` | no | light, dark | may resolve to `none` |
| Optional | `banner` | no | | may resolve to `none`. Off unless `enabled` is true. Needs both `en` and `ar` text, at most 90 characters each. |

The sizes for native launcher icons are checked per platform where a build can replace them.

### Colour for each part

Semantic colours such as `primary` and `surface` are not enough on their own. `tokens/components.json`
gives every part of the interface its own colour, in each theme and mode, and pages use those part
colours. Each part names a semantic colour by default. A theme overrides a part per mode under
`component.<mode>`, and a child theme inherits overrides. On the web a part is `--fanous-c-<part>`.

| Area | Parts |
|---|---|
| Header | `nav.*`: background, border, text, icon, hover, active item and indicator, search field, account menu |
| Phone drawer | `drawer.*` |
| Buttons | `button.primary`, `.secondary`, `.ghost`, `.destructive`, `.icon`: background, text, border, hover, pressed, focus, disabled |
| Upload | `upload.*`, the same set plus icon |
| Forms | `form.*`: section, label, help, input, placeholder, focus, error, success, checkbox, switch |
| Cards | `card.video.*`, `card.channel.*` |
| Tabs | `tabs.*`, `segment.*` |
| Overlays | `menu.*`, `dialog.*`, `toast.*` |
| Badges | `badge.*`: live, duration, status |
| Player | `player.*`: controls, progress, buffered, track |
| Other | `footer.*`, `link.text`, `divider.line`, `skeleton.*`, `empty.*` |

CI checks every part pair for contrast in every theme and mode, holds text on the primary and upload
buttons to 7:1, and applies the logo-hue rule to overrides. Part colours reach the web output today.
Native outputs follow when those apps adopt them.

## Build-time selection

`fanous-tokens build --theme <id> --app <app> --out <dir>` validates the theme, resolves its chain and
writes the flat output into a gitignored directory. Apps import from that directory. Every
theme is also committed under `generated/<theme>/<platform>/` for inspection and snapshot tests.

The value is committed, so a theme change is reviewed and reaches production only through a tag
release. The CI matrix overrides it with the `ACTIVE_THEME` environment variable.

| App | Repo | Stack | `ACTIVE_THEME` set in | Consumes tokens through | Light and dark today |
|---|---|---|---|---|---|
| Videos | AlUmmahNow `apps/web` | Next, OpenNext | `vars` in `wrangler.{qa,staging,production,preview}.jsonc` | prebuild output imported by `globals.css`, shadcn variables mapped to tokens | system default, toggle in the left navigation, `.dark` class |
| Admin | AlUmmahNow `apps/admin-web` | Next, OpenNext | `vars` in `wrangler.{qa,production}.jsonc` | same as Videos | `admin_theme` cookie, `data-theme`, system fallback |
| Auth | AlUmmahNowAuth `apps/auth` | Worker, openauth | `vars` in `wrangler.{qa,}.json` | generated module passed to the openauth `theme`, and to `src/ui` and `email-templates.ts` | openauth light and dark. Custom pages have no mode handling. |
| Profile | AlUmmahNowAuth `apps/profile` | Worker, HTML strings | `vars` in `wrangler.{qa,}.json` | generated CSS module | no mode handling found |
| Auth admin | AlUmmahNowAuth `apps/admin` | React Router, Tailwind | `vars` in `wrangler.{qa,}.json`, read by the prebuild | prebuild CSS | no mode handling found |
| Shared switcher | AlUmmahNowAuth `packages/ui` | React | none, inherits from its host | CSS variables only | host |
| Sign-in fork | openauth | Library | none, receives a theme object | extend `Theme` where the current hooks fall short | `ColorScheme` values |
| CMS | AlUmmahNowCMS | Hono Worker around bknd 0.21 | env `vars` in `wrangler.jsonc` | see [CMS](#cms) | light only: the admin is forced with `adminOptions.theme: "light"` |
| Site | AlUmmahNowUI | Astro, Tailwind | env `vars` in `wrangler.jsonc` | prebuild CSS | light only |
| Android | AlUmmahNowAndroid | Compose | `gradle.properties`: `activeTheme` | synced `FanousTokens.kt` in `design` | app setting, system |
| Apple | AlUmmahNowApple | SwiftUI | `Configs/{Base,QA,Prod}.xcconfig` | `AUNDesign` from the generated package | app setting, system |
| Desktop and TV | AlUmmahNowDesktop | WinUI, GTK, Tizen NUI | `Directory.Build.props`: `ActiveTheme` | synced generated files | per platform |
| Importer | AlUmmahNowTools Uno app | Uno, XAML | MSBuild property | `Fanous.Colors.xaml` | per platform |

`AlUmmahNowCore` renders no UI and is out of scope.

### Light and dark on every surface

The last column above is the starting point. Surfaces with no mode handling, or with only one mode,
gain both: Profile, the auth custom pages, Auth admin, the CMS and the marketing site. Any other
surface found during migration is held to the same rule.

Apart from the CMS admin, which is covered below, these surfaces have no toggle, so their mode follows
`prefers-color-scheme` in the generated CSS. Using
CSS alone means no script and no flash on load. Videos, Admin and the native apps keep their existing
toggles and settings.

**Exceptions**

| Surface | Why it has one mode | What it does instead |
|---|---|---|
| Transactional emails | Mail clients control rendering and support for dark styles is unreliable | One light layout, using the theme's `email` slots |

A new exception needs a row here and a reason.

### CMS

The CMS supports both modes and takes as much of the active theme as bknd allows. Its Worker serves two
kinds of page:

| Pages | Rendered by | Mode | Theme |
|---|---|---|---|
| Video picker and sign-in status pages | Our code, `src/lib/html.ts` and the routes | `prefers-color-scheme` in generated CSS | Full |
| Admin at `/`, `/data/*`, `/media/*` and the rest | bknd's built-in UI | `adminOptions.theme: "system"` | Partial |

bknd 0.21 offers one theme setting, `system`, `dark` or `light`, and no custom CSS or logo option. Its
`logoReturnPath` only sets where the logo links.

The Worker already rewrites the admin's HTML in `decorateAdminHtml`, so it also adds a generated `<style>`
that maps bknd's surface and text variables to the active theme, in both modes: `--color-background`,
`--color-muted`, `--color-lightest`, `--color-darkest` and `--color-primary`, set on `.bknd-admin` and
`.bknd-admin.dark`. The existing `style-src` policy allows this.

**What the admin keeps from bknd, in every theme:**

- Its logo in the header and its favicon.
- Its buttons and form controls. They are Mantine components configured inside bknd, so primary actions
  are not gold or the theme's primary colour.
- Its warning, error, success and info colours, and a few fixed status colours.
- Its fonts, radius and shape.
- No sign-in graphic, motif, banner or motion.

bknd reads the system setting when the admin renders, so a system change shows on the next load. The admin
has no toggle, because the `system` option overrides bknd's own stored choice.

Those variable names are bknd internals rather than a public API, so the version stays pinned and a smoke
test in the matrix asserts the mapped colours in both modes. A bknd upgrade that renames them fails CI.

**Across repos:** the monorepo publishes `@al-ummah-now/fanous-themes` to GitHub Packages for JavaScript
repos and attaches the same files to a tagged release for native repos. Each native repo pins a version
and commits the synced output, with a CI check that the copy matches the pin.

**Stores:** a native theme change needs an app release and store review. Event themes therefore target
web apps by default, and each theme lists the `platforms` it supports.

## Keeping pages themeable

Light and dark must not depend on `dark:` pairs of raw colours. Each page uses semantic tokens, which
already differ per mode.

Current state on `main`, in lines outside tests and generated files:

| Surface | Hard-coded hex lines |
|---|---|
| `apps/web/src` | 106, plus 3,123 lines with raw Tailwind palette classes |
| `apps/admin-web` | 105 |
| `apps/auth/src` | 88 |
| `apps/profile/src` | 55 |
| `apps/admin` | 13 |
| openauth `src/ui` | 30 |
| AlUmmahNowUI `src` | 17 |
| AlUmmahNowCMS `src` | 3 |

**Lint gate, `check:theme-colors`:** each repo fails CI on hex, `rgb()`, `hsl()` and `oklch()` literals,
arbitrary Tailwind colours such as `bg-[#123456]`, and raw palette utilities such as `bg-gray-800`
outside the generated output. Existing violations sit in a per-file allowlist of counts that may only
go down, so new drift fails on day one. The allowlist reaches zero as each surface migrates.

## CI

Validation runs for every registered theme and fails with a message naming theme, slot and mode:

- an unknown `extends` id;
- a cycle in the `extends` chain, printing the chain;
- a required slot still unresolved after walking the chain;
- a standalone theme missing a slot, for example `newbrand: slot color.dark.surface is missing (standalone theme)`;
- a missing file, or an icon or OG image with the wrong format or dimensions, read from the file header;
- an SVG motif containing a script or external reference;
- a banner with only one language;
- any colour pair below WCAG AA after resolution, in either mode;
- `onPrimary`, `onPrimaryHover` or `onPrimaryPressed` below 7:1.

Optional slots may resolve to `none`.

**Matrix:** each app builds once per registered theme and runs the token lint plus a smoke check per
theme and mode. Both modes are required on every surface except the listed exceptions, including those
that gain modes in this work. Web apps open key pages in English and Arabic and assert that the primary button
computes to the theme's token and that axe passes. Native apps generate and compile for each theme. A
broken theme fails CI even when Lantern is deployed.

The videos build is the slowest. The matrix runs on pull requests that touch themes, tokens or UI code,
and nightly on `main`.

## Runbooks

**Start an event theme**

1. Add the theme with `extends` set to the theme it layers on, and merge it once the matrix is green.
2. Get owner approval of the before and after screenshots.
3. Change `ACTIVE_THEME` for QA, deploy and check it.
4. Change `ACTIVE_THEME` for production and ship it through the normal tag release.

**End an event theme**

1. Set `ACTIVE_THEME` back to its previous value and ship through the normal tag release.
2. Keep the theme registered for next year, so CI goes on proving it builds.

Purge the CDN for the favicon, the manifest and the OG image after either change. Social networks cache
share images on their own schedule, so an old image can linger there.

**QA and production show whatever their config says.** Neither moves to a new theme without owner
approval of the screenshots.

## Delivery order

Infrastructure with no visual change merges once CI is green. Visual pull requests wait for owner
approval of the screenshots.

1. Registry, parent resolution, validation and flat output, with Lantern moved into `themes/lantern`. Infrastructure.
2. `check:theme-colors` with allowlists in each repo. Infrastructure.
3. `ACTIVE_THEME` wiring, `prefers-color-scheme` output for surfaces without a toggle, and the theme and mode CI matrix per app, starting from Lantern output. Infrastructure, except that a surface gaining a mode changes visually for people on the other system setting, so that part ships with step 4.
4. One pull request per app: map variables to tokens, migrate colours and turn on both modes. Visual, starting with `apps/web`. Screenshots cover every theme in both modes.
5. Build the owner's chosen theme 2, and theme 3 if one is picked, as data. Visual.
