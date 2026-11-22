# Navigation: one header, one account menu (all apps)

Status: adopted 2026-11-12. Applies to the videos web (`apps/web`), the videos admin
(`apps/admin-web`), www (AlUmmahNowUI), the CMS (AlUmmahNowCMS), the profile app and the auth
admin (AlUmmahNowAuth).

Fixed by earlier decisions and not reopened here:
- every app follows the admin-chosen site theme (Fanous: fawanees, lantern, zujaj, nahas; light and dark);
- the header bar is dark in every theme and mode;
- everything that opens from it (the account menu with its channel layer, every header menu) and
  the drawer never take the header's colours: in **light mode** they sit on the page **background**
  (`--fanous-color-background`), in **dark mode** on the theme's menu colours (owner review of the
  mockups, 2026-11-12: "the account menu should follow the bg colors", "I said bg color");
- destructive actions confirm in an in-app dialog, never a browser prompt.

## Shared code

The stacks differ (Astro, Next.js/React, Hono JSX, a string-template Worker, React Router), so what
every app shares is a **framework-free CSS + markup contract**, not a component:

- `packages/fanous-tokens/nav/aun-nav.css`: the canonical stylesheet. It uses Fanous tokens only
  (`--fanous-c-nav-*` for the header controls only; for menus the page's `--fanous-color-*` in
  light mode and `--fanous-c-menu-*` in dark;
  `--fanous-radius-*`, `--fanous-spacing-*`, `--fanous-elevation-*`). Size fallbacks equal the
  token values, so an app that vendors only the colour tokens renders the same.
- Each repo vendors it at a pinned commit with its Fanous sync script (www and CMS `sync:fanous`,
  Auth `packages/ui`). The videos apps import it directly.
- Class names are the contract. Markup may be JSX, Astro or a template string, but it uses
  these classes and the ARIA below.

## Header

One header in every app: videos web, videos admin, www, the developer site (alummahnow.dev),
scholar sites, status, CMS admin, auth
admin, profile and the sign-in pages (owner, 2026-11-14: "UNIFY"; every difference between apps is
a bug). Based on www and the videos web, which the owner reviewed. The wiki's design-system page
(E10, "Header") carries the same spec.

**Shared code.** `nav/aun-nav.css` styles it and `nav/header.js` builds the markup (brand,
environment badge, menu button, language, light/dark, Sign in). Worker, Hono and Astro apps render
the builders, or a byte-identical copy checked by the repo's Fanous sync check. React apps render
the same elements as JSX and their tests compare the result with the builders.

**Bar** (`.aun-header`; `.aun-header-row` inside it only when an app's markup wraps the groups):
- 4rem (64px) tall; 3.5rem (56px) below 640px, the 1px bottom border included, with or without a
  `.aun-header-row` inside (the row is the height less the border). Sticky at the top.
- **Band**: the theme's header material, the same in every app (see **Theme** below), painted on
  the bar's own layer (`.aun-header::before`) over the shared chrome blur (`--aun-glass-blur` of
  `surfaces/aun-surfaces.css`, `blur(20px) saturate(1.6)` where an app does not load it); else
  `--fanous-c-nav-bg`. `--aun-header-bg` overrides it only for a page outside the themes: no Al
  Ummah Now app sets it. 1px bottom border `--fanous-c-nav-border`; text `--fanous-c-nav-text`.
- **Full width in every app.** The bar's groups are never centred in a max width: the brand is
  16px from the screen's edge (12px on phones) in www, scholar sites, status and profile exactly as
  in videos web and the admins, so every header lines up.
- **One typeface** in every header, set by the contract whatever the page uses: system-ui
  (`--aun-header-font`), Arabic 'Noto Naskh Arabic' then Geeza Pro, then system-ui so Latin inside an Arabic header matches English (`--aun-header-font-ar`).
  The header's controls (buttons, summaries and inputs: the account button and its name, the menu items, the
  search field) use the theme's body font where the theme has one (Nahas: Source Serif 4, Arabic
  Amiri; Zujaj: Inter, Arabic Noto Kufi Arabic), as videos always did; Fawanees and Lantern keep the
  header typeface.

**Theme** (owner ruling 2026-11-22, UNIFY: one source for every app). Each built-in theme's header
look is generated from its theme package (`packages/theme-packages/themes/<id>/theme.json`) into
`aun-nav.css` between the `BEGIN theme header` / `END theme header` markers, by
`pnpm --filter @al-ummah/theme-packages themes:build` (`themes:check` fails when it is stale). So
videos, the videos admin, status, Auth profile and admin, the CMS admin, www and the scholar sites
read the same values from the stylesheet they already vendor:

| Variable / rule | From the package | Notes |
|---|---|---|
| `--aun-header-band` | `components.header.style.background` | `{material.*}` written out, so apps without the videos materials paint the same band |
| `--aun-header-edge` | `components.header.style.edge` | the bar's `box-shadow` |
| `html[data-theme=<id>] .aun-header button, summary, input, select, textarea` | `typography.body` | Latin stack; `:lang(ar)` gets the Arabic stack |

The variables are set on `html[data-theme='<id>']` (the default theme also on `html:not([data-theme])`),
so every app marks its theme on `<html>`. A built-in theme's header has no light-only style (the
build refuses one): apps mark light and dark differently. Uploaded themes compile the same block into
their published `theme.css` (`compilePackage().nav`; versions published before it get it on their
first read, like the art).

**Fonts**: `nav/aun-nav-fonts.css` declares the faces those stacks name, from `nav/fonts/*.woff2`,
which every app serves at `/aun-nav/fonts/` (no other host, so `font-src 'self'` covers it). They are
the videos app's own files byte for byte (`apps/web/public/fonts`, `font-faces.css`, which videos
keeps); the videos admin serves a copy in `public/aun-nav/fonts`. `test/nav-theme.test.ts` checks
the block, the faces and the copies.
- **One line on every screen.** The bar never wraps to a second row (`flex-wrap: nowrap`); when
  room runs out the brand is the one group that shrinks, and its wordmark (a long scholar site
  name too) ends in an ellipsis; below 400px it is hidden and the logo stays. Sites whose own links sit in
  the bar (www, scholar sites, the dev site) mark that group `.aun-header-primary.aun-collapse`:
  below 1024px it leaves the bar and the menu button (`menuButtonHtml`, slot 1) opens an
  `.aun-header-panel` popover right under the bar with those links and the search. It opens
  without script (`popovertarget`), Escape and a tap outside close it.
- Padding-inline 16px (12px below 640px). Gap between groups 16px, 12px below 1024px, 8px below
  640px, 4px below 400px. Inside the tools group 8px (4px below 640px).

**Order** (reading order; it mirrors in Arabic; `HEADER_ORDER` in `nav/header.js`: menu, brand, env,
primary, actions, lang, mode, account):

**No links to other sites in the header or side rail** (owner, 2026-11-15): no Website / Videos
pills, and no "Website" item in the videos side rail or drawer, at any width. The logo leads to the
app's own home; the other apps are in the account menu's "Al Ummah Now apps" (and, on status, which
has no account menu, the page footer). Pages with no account menu and no footer link (the sign-in
pages, a scholar site whose platform mark is "none") have no route to www; that is accepted
(owner, 2026-11-15).

**Scholar sites keep their own theme colours** (owner, 2026-11-15). The header's layout, sizes and
controls are the same as every app's; its colours come from the site's admin-chosen theme through the
nav tokens (`--fanous-c-nav-*`) and the theme header block (`--aun-header-band`), so a Nahas site has
Nahas's dark header and band. No app CSS overrides the header colours or band.

| # | Slot | Class | Notes |
|---|---|---|---|
| 1 | Menu | `.aun-icon-btn.aun-menu-btn` | Lucide `menu`, named "Menu" / "القائمة", 40×40 (never `.aun-menu`: that is the account menu's surface). Apps with a side rail or drawer (always shown), and sites with a panel (`.aun-menu-collapse`, below 1024px only). |
| 2 | Brand | `.aun-brand` | Logo, wordmark, app name (below). Links to the app's own home. |
| 3 | Environment badge | `.aun-env` | "QA" / "STAGE" right after the brand; never in production. |
| 4 | The app's own links or search | `.aun-header-primary` | www links, the videos/CMS search, the admin ⌘K search. Takes only the room the other groups leave (`flex: 1 1 0%`), so a long primary area never pushes the tools to a second line. Present (empty) when an app has none. |
| 5 | App actions | in `.aun-header-tools` | Upload, notifications, Create/New. 2.5rem tall pills. |
| 6 | Language | `.aun-lang` | The other language's own name. |
| 7 | Light/dark | `.aun-icon-btn.aun-mode` | Sun in dark mode, moon in light. |
| 8 | Account | `.aun-acct-btn`, or `.aun-signin` | Signed out: a solid "Sign in", never hidden in a menu. |

**Language first, then sun/moon** in every app (settled 2026-11-14; www and the dev site change to
match). Language and light/dark sit in the header in every app, next to each other in this order. They are
no longer at the foot of a side rail. There is no language dropdown or select anywhere: two
languages, one button.

**Controls.** Every control is 2.5rem (40px) tall, fully round, 1px `--fanous-c-nav-search-border`,
transparent, text 15px/500 `--fanous-c-nav-text`, hover `--fanous-c-nav-hover`. Icons are 18px.
Focus everywhere is a 2px outline in `--fanous-c-nav-active-text`, offset 2px.
- **Brand.** The owner's logo (`/brand/logo-64.webp`), round, 36px (32px below 640px); 10px to the
  text. Wordmark "Al Ummah Now" / "الأمة الآن", 16px/700 (Arabic 18px); a white-label scholar site
  passes its own site name instead (`brandHtml({ name })`, escaped; never by patching the output).
  Every app but www adds a second line with its name, 12px/500 `--fanous-c-nav-icon`: Videos /
  المرئيات, Admin / الإدارة, Status / الحالة, Developers / «المطوّرون» (alummahnow.dev), Content,
  Accounts admin, Account. Hover `--fanous-c-nav-hover`, radius 10px. Below 400px the text is hidden
  and the logo stays (the text stays the link's name).
- **Environment badge.** 20px tall pill, 11px/700, letter-spacing 0.06em, `--fanous-c-nav-active-text`
  background with `--fanous-c-nav-bg` text. Its name is "QA environment" / "بيئة الاختبار QA".
  Below 400px it sits on the logo's lower inline-end corner (ringed in `--fanous-c-nav-bg`), so it
  takes no room of its own.
- **Language** (`.aun-lang`). Shows the other language's own name in its own `lang`
  (`<span lang="ar">العربية</span>`), `hreflang` on the link. Its name starts with the action in the
  page's language and contains the visible label: "Switch to Arabic: العربية" /
  "التبديل إلى الإنجليزية: English". No aria-label on the language button; the visible label must be
  inside the accessible name (WCAG 2.5.3, axe `label-content-name-mismatch`, which every header axe
  check switches on, in English and Arabic). It keeps the current page and query, each app's way of storing
  the choice (URL prefix, `?lang=`, cookie) and the RTL flip; hreflang alternates are not touched.
  A link built from the request path goes through `samePath()` (`nav/header.js`): leading slashes
  and backslashes collapse to one "/", so `//evil.example` can never become a protocol-relative link
  to another host. A link that starts with a locale prefix (`/ar` + path) is already safe.
- **Light/dark** (`.aun-icon-btn.aun-mode`). One button, no menu and no "System" option (owner
  decision 2026-11-13): Lucide 0.487's sun and moon from `nav/mode-toggle.js`, the moon in light mode
  and the sun in dark. The name is the action ("Switch to light mode" / "التبديل إلى الوضع الفاتح"),
  repeated in `title`, no aria-pressed.
- **Account** (`.aun-acct-btn`). See "Account button". The name is hidden below 768px; below 400px
  the caret is hidden too and the button is the avatar alone. Apps with no sign-in (status) have no
  account control.
- **Sign in** (`.aun-signin`). Solid pill, `--fanous-c-nav-active-text` background, `--fanous-c-nav-bg`
  text, 15px/600, padding-inline 16px.

**Phone** (below 640px): 56px bar, the account name is hidden (from
768px), the brand logo shrinks to 32px; below 400px only the logo shows. Apps with a long primary
area (www links, search) move it to its own row or an icon that opens a sheet; the tools group never
wraps or hides the language, light/dark or account controls.

**Per-app fit.** Where an app's bar holds more than the base, these keep it on one line at every
width from 320px (the language, light/dark and account controls never move):
- *Videos web.* Below 1024px the brand is the logo alone, the search is an icon that opens a sheet,
  and Upload is a 40px icon (its label stays its name). Below 640px the drawer toggle and Upload
  leave the bar for the bottom tab bar (Home, Explore, Upload, Subscriptions, You, More; More opens
  the drawer; Upload only while a channel is active, so acting as yourself the bar has five tabs).
- *Videos admin.* Full width over the sidebar: the ⌘K search is an icon below 1280px and the
  breadcrumbs show from 1024px; below 640px, beside the drawer button, the brand is the logo alone. Public pages (sign-in, access denied) have the same bar, with Sign in when signed out. Signed in to Al Ummah Now without the admin role (access denied), the bar shows the account menu, read from Auth (that person has no admin session), so they see who they are and can switch accounts; never Sign in.
- *Status.* No drawer and no account: the page footer links Website and Videos.

There is one sign-out entry, inside the account menu. The header has no separate "Log out" button.

## Account button

`<button class="aun-acct-btn" aria-haspopup="menu" aria-expanded aria-controls>`:

- `.aun-avatar`: the profile photo, else the first letter of the name on `--fanous-color-primary`.
  In the videos app the button shows the **identity you act as** (owner rule 8): with a channel
  active, the channel's logo (else its first letter) and the channel's name; acting as yourself
  (Personal), your own photo and display name. Other apps always show the account.
- `.aun-acct-name`: the **display name** (the active channel's name in the videos app, above), chosen by the platform rule
  (`packages/shared-types/src/display-name.ts`, mirrored in Auth `packages/ui/src/display-name.ts`):
  1. the display name in the page language;
  2. the plain display name;
  3. first + last name;
  4. a name in the other language;
  5. `@handle`;
  6. the email, only when there is nothing else.
- `.aun-caret`, in the name's colour (`--fanous-c-nav-text`) in every app.
- Pill shape (`--fanous-radius-full`), 2.5rem tall, 1px `--fanous-c-nav-search-border`. Hover
  and open use `--fanous-c-nav-hover`. Focus is a 2px `--fanous-c-nav-active-text` ring.
- Below 768px the name is visually hidden but stays the accessible name. The button shows the
  avatar and the caret (below 400px the avatar alone).
- The name has one width, 9rem, with an ellipsis: switching who you act as ("Community Corner" and
  "Amina Yusuf") never moves the header's other controls, and a long name never pushes the header
  apart (AUDIT-2 2026-11-21: Upload, the bell, language and theme moved 47px on a switch).

## Account menu

`<ul class="aun-menu" role="menu">` (or a plain disclosure list), opening under the button at its
inline end. Every app builds the same **base**. One app may add its own layer in one defined place,
the **context slot**. Sections, top to bottom, with `.aun-menu-sep` separators between them:

| # | Section | Base or slot | Every app | Videos (web + Studio) |
|---|---|---|---|---|
| 1 | Who | base | yes | yes |
| 2 | **Context slot** | slot | empty | the **channel layer** (below) |
| 3 | More accounts + Sign in to another account | base | yes | yes |
| 4 | This app | base | the app's own entries (≤ 4) | Write article / My articles (scholars), Settings |
| 5 | Al Ummah Now apps | base | yes | yes |
| 6 | Sign out | base | yes | yes |

An app with nothing to put in the slot leaves it out, separator included. Its menu then has the
base shape exactly (www, CMS, profile, videos admin, auth admin).

1. **Who** (`.aun-menu-who`): the current account at the top, on the **menu's own background**
   like every other row (no tinted panel: owner review, "why is the name in a different colour?"),
   separated from the rest only by the normal divider: a 2.5rem avatar, the name (1rem, weight 600)
   and the email muted under it. An app may add one muted line here (the CMS role). Who never shows the
   channel; that is the slot's job. Who **is** the current account: it is not listed again below
   (the Google account pattern, owner choice in revision 5).
2. **Context slot** (`<div class="aun-menu-context" role="group" aria-labelledby>` with a
   `.aun-menu-label`): one app-specific layer, see [Context slot](#context-slot-the-videos-channel-layer).
3. **More accounts** / «حسابات أخرى» (`.aun-menu-label`), shown when the browser has other
   signed-in accounts. It lists only the **other** accounts, never the current one (that is Who).
   Each row is `.aun-acct-row`:
   - the entry is a button, "Switch to {name}": avatar, name and email muted under it. Rows run
     **edge to edge**: the hover / focus fill covers the menu's full width, the sign-out button
     included, so the row reads as one target;
   - each row ends with a `.aun-acct-signout` **icon button** (the sign-out arrow, `.aun-flip` in
     Arabic, round 44px target), never the words "Sign out" beside the row. Its accessible name
     and tooltip (`title`) are "Sign out of {name}" / «تسجيل الخروج من {name}»; it confirms first
     in the in-app dialog.

   **Sign in to another account** / «تسجيل الدخول بحساب آخر» follows (it was "Add another
   account"; the new words say what happens: the sign-in form, then that account is added), with
   the sign-in icon (an arrow into a door, `.aun-flip` in Arabic). It is shown even with one
   account. The CMS has no in-menu switch (its session is per app): its "More accounts ›" row
   opens the accounts page (`/sso/accounts`) instead of listing them.

   **Emails** keep their domain when they do not fit: `.aun-email` splits the address into the
   local part, which shrinks with an ellipsis, and "@domain", which stays whole
   (`omar.abd…@alummahnow-community.org`); the full address is the tooltip. A name in the other
   script (a Latin name in an Arabic menu) keeps its own direction but lines up with the menu's
   start.
4. **This app** (no label): the app's own entries, at most four. Videos: Write article, My
   articles (scholars), Settings. Profile: Manage sessions.
5. **Al Ummah Now apps** (label): links to the other apps the account may open, gated by role
   like each app's own guard. The current app is left out. Each entry starts with **that app's own
   favicon**, whole, in a circle (`.aun-app-icon[data-app]`): the owner's art as is, never a drawn
   or generic icon, a colour tile, a badge or a recolour (owner: "use icons we choose for favicons,
   not random ones"; "use the full favicons, cropped to a circle").
   - Source: the app's highest-resolution favicon asset, the 512px crop it serves as
     `icon-512.png` (byte-identical to the pipeline's output), downscaled only (Lanczos) to 96px,
     lossless WebP (every visible pixel equal to the PNG).
   - Shape and size: the whole square scaled into a circle the size of the account avatars (2rem)
     in the menu, and 3rem on the profile app's "Your apps" cards (`.aun-app-icon--card`), so
     menus and cards show the same images, consistently for every app.
   - Delivery: **separate static files, never inlined in the stylesheet** (inlined, they made the
     render-blocking CSS 120 KB on every page). `packages/app-icons` `src/nav-icons.ts` writes
     `packages/fanous-tokens/nav/icons/<id>.webp` (and the videos web and admin `public/`
     copies); every app serves them same-origin at `/aun-nav/icons/<id>.webp` (www and the auth
     admin from `public/`, the CMS and profile Workers from a generated module, all vendored by
     their sync at the same ref, with hashes in the lock). Menus use
     `<img class="aun-app-icon" src="/aun-nav/icons/<id>.webp" width="32" height="32" alt=""
     loading="lazy" decoding="async">` (48 on the cards), so they load only when the menu opens.
   - Checks: `check:nav-icons` regenerates the files from the same crop as `icon-512.png` and fails
     on any difference; a token test rejects any `url()` or `data:` in `aun-nav.css` and keeps it
     under 32 KB; the sync guards reject any `url()`. The order and labels are fixed:

   | Order | English | Arabic | Favicon | Who sees it |
   |---|---|---|---|---|
   | 1 | Website | الموقع | www (the logo) | everyone |
   | 2 | Videos | المرئيات | videos | everyone |
   | 3 | Your profile | ملفك الشخصي | profile | everyone |
   | 4 | Content management | إدارة المحتوى | cms | super_admin, admin, moderator, scholar |
   | 5 | Videos admin | إدارة المرئيات | videos-admin | super_admin, admin, moderator |
   | 6 | Accounts admin | إدارة الحسابات | auth-admin | super_admin, admin |

   The role gates mirror the profile app's catalog (AlUmmahNowAuth `apps/profile/src/apps.ts`),
   which mirrors each app's own access guard. Videos and admin-web share
   `packages/shared-types/src/app-links.ts`.

6. **Sign out**: "Sign out" signs this account out (with other accounts, the next one takes
   over). With two or more accounts, "Sign out of all accounts" (`.aun-menu-item--danger`)
   follows it and asks first in the in-app dialog. Every app has both, the videos admin included.

## Context slot: the videos channel layer

Only the videos app (web and Studio) fills the slot. A channel belongs to an account: an account
can own several channels and hold roles on other people's. The **active channel** scopes Upload
and Studio. Switching channels never switches the account, and switching accounts brings that
account's own channels and active channel.

`<div class="aun-menu-context" role="group" aria-labelledby="…">`, label **Acting as** / **تتصرّف باسم**, then
in this order. Identities follow the YouTube/Facebook pattern: you are shown by your own avatar and
name (display name → first + last → email, never an @handle) with a small `.aun-identity-tag`
**Personal** / **حساب شخصي**; a channel by its logo and name with the tag **Channel** / **قناة**.
Never "no channel", "without a channel" or "none".
This menu is the **only** place to choose an identity (owner decision 2026-11-15). Comments, replies,
posts, likes, subscriptions and playlists always use the current acting identity; their composers show
only that identity's avatar (photo or channel logo, accessible name = the identity's name), with no
"Commenting as" text, no Switch link and no per-action picker.

| Row | What | When |
|---|---|---|
| Current channel (`.aun-menu-context-current`) | logo + name + tag **Channel**, crown on the main channel, a `.aun-badge` role chip when the account is not the owner ("Channel admin"); links to the channel | a channel is active |
| You (`.aun-menu-context-current`, not a link) | your avatar + name + tag **Personal** | no channel is active |
| **Switch channel ›** | opens the switcher in place (below) | always (an account without channels can still pick itself) |
| **Studio** | the creator home, on the active channel | the account has at least one channel |
| **Create channel** | opens the switcher with the create form | the account has no channel yet and may create one |

**Switcher view** (in place, a back row "‹ Acting as" at the top):
0. You: your avatar + name + tag **Personal**, checked when no channel is active.
1. "Your channels" (`.aun-menu-label`): the account's own channels; the active one checked (`aria-checked`, `.aun-menu-check`).
2. "Channels you manage": channels where the account holds a role, each with its `.aun-badge`.
3. **Create channel** (`.aun-menu-form` with `.aun-menu-input`), only while the tier allows another channel.
   At the tier's limit (`channel_limit`: `channelsOwned >= maxChannels`), the row is replaced by
   a `.aun-menu-note` "You can own up to {max} channels". A create the server refuses for the
   limit (another tab used it up) reads the tier again, closes the form and shows the same note,
   never a generic error. Without a creator tier (by invitation) there is neither Create nor the note.

Upload is **not** in the menu (owner review, revision 5, the YouTube pattern): the channel layer
leads to Studio, and uploading starts from the header's Upload action (see [Header](#header)),
which targets the active channel. Acting as yourself (Personal, no channel active) there is no
Upload at all, in the header or the phone tab bar (owner rule 6: no greyed-out control); it comes
back as soon as a channel is chosen here.

Coverage: `apps/web/e2e/themes/channel-layer.spec.ts` (two accounts with several channels each, the
limit, a refused create, a viewer, the switcher's contrast in every theme), local, mocked API
fixtures (`e2e/themes/mock-server.mjs` `CHANNEL_FIXTURES`).

## Menu surface (every menu from the header: account, theme, launcher, create)

A menu is not part of the header and never takes its colours. In **light mode** it sits on the
page **background** (in Fawanees light the cream `#fff1c4`, not the gold surface) with the page's
text, and an outline border plus a soft shadow lift it off the page and the cards. In **dark mode**
it keeps the theme's menu colours (Lantern `#134a62`). The stylesheet switches with CSS
`light-dark()`, which follows the page's `color-scheme`, so every app sets `color-scheme` per mode
(`light` / `dark`, or `light dark` when it follows the system).

| Property | Light mode | Dark mode |
|---|---|---|
| Background | `--fanous-color-background` | `--fanous-c-menu-bg` |
| Text / muted | `--fanous-color-text-primary` / `--fanous-color-text-secondary` | `--fanous-c-menu-text` / `--fanous-c-menu-muted` |
| Hover / pressed / current row | `--fanous-c-menu-hover` mixed 50% into the background (a light tint) | `--fanous-c-menu-hover` |
| Border | 1px `--fanous-color-outline` | 1px `--fanous-c-menu-border` |
| Separators, role-chip border | `--fanous-color-text-primary` mixed 45% into `--fanous-color-background` | `--fanous-c-menu-text` mixed 45% into `--fanous-c-menu-bg` |
| Shadow | `--fanous-elevation-medium` | `--fanous-elevation-medium` |

| Property | Value (both modes) |
|---|---|
| Radius | `--fanous-radius-md` (8px). Rows are square: they run edge to edge |
| Padding | 4px at the bottom only; the who panel starts at the top edge |
| Width | 21rem on every view and in every app (the channel switcher does not narrow it) |
| Item | 2.75rem min height (touch target), 16px inline padding, 0.9375rem text |
| Account row | 3.25rem min height (two lines), sign-out icon button at the end |
| Leading column | 2rem (`--aun-menu-lead`): 1.25rem icons centred in it, 2rem round app favicons and 2rem avatars, so every label starts at the same line, in both directions |
| Section header | 0.75rem, weight 700, muted, 8px above and 4px below, never upper-cased or letter-spaced (Arabic) |
| Separator | full width, 4px above and below (none between the who panel and the first one) |
| Role chip (`.aun-badge`) | 11px, weight 600, pill, 1px separator border, muted text |
| Note (`.aun-menu-note`) | 13px, muted, the rows' 16px inline padding; why an action is missing |
| Focus | 2px `--fanous-color-focus-ring` outline, inset 2px |
| Current / checked | the hover fill, weight 600, `.aun-menu-check` (`--fanous-color-link`) at the end |
| Danger | `--fanous-color-error-text` |
| Phone (≤ 30rem) | a sheet under the header: full width less 8px each side, scrolls inside |
| Never off-screen | every menu and popup stays inside the viewport at any width (phones, landscape, tablets, en and ar): see below |
| Selectors | never "a :is(b)" (a space before a pseudo-class function): the CMS minifier drops the space; a test rejects it |

Contrast (computed from the tokens, every theme): light mode, text, muted, danger and the check on
the background and the hover tint are 5.10:1 or more; dark mode (the menu tokens) 4.69:1 or more.

Lines must show, in every app's menu (owner reviews: "in dark you can't see the lines between
rows", the CMS menu in dark teal and brown, then www and profile: "the dividers are too faint").
The separator is one shared rule, `--aun-menu-line`: the menu's text mixed 45% into the menu's
surface, in both modes. The themes' divider tokens are 1.0–1.8:1 on the menus, too faint, so no
app uses them for menu lines.

| Line | Light mode | Dark mode | Floor (checked) |
|---|---|---|---|
| Separators between sections | 2.47–2.73:1 (Lantern 2.55, Fawanees 2.73, Zujaj 2.47, Nahas 2.69) | 2.60–3.81:1 (Lantern 3.03, Fawanees 3.21, Zujaj 2.60, Nahas 3.81) | 2.4:1 both modes |
| Outer border | 3.57–5.12:1 on the background | 3.24–4.40:1 on the menu | 3:1 |

Checks:
- `packages/fanous-tokens/test/nav-lines.test.ts` resolves `--aun-menu-line`, `--aun-menu-edge` and
  `--aun-menu-bg` from the stylesheet against every theme's tokens in both modes. It guards every
  app that vendors the stylesheet (videos web and admin, www, CMS, profile, auth admin).
- `apps/web/e2e/themes/account-menu.spec.ts` measures the rendered lines in every theme ×
  light/dark × en/ar (`menuLineContrast` in `e2e/themes/harness.ts`).

Keyboard: ↓ on the button opens and focuses the first item; ↑/↓ move, Home/End jump; Escape
closes and returns focus to the button. A click outside or tabbing out closes it.

RTL: logical properties only. Directional icons (back, chevron, sign-out arrow) carry `.aun-flip`.

## Drawer and side rail

These keep each app's layout (the videos left navigation, the admin groups, the CMS rail). Like
the menus they never take the header's colours: in **light mode** the drawer and rail sit on the page
background (`--fanous-color-background`) with a 1px `--fanous-color-divider` inline-end edge, and a
soft shadow (`--fanous-elevation-medium`) when the drawer opens over the page; in **dark mode** they
keep `--fanous-c-drawer-*` (the app's material). The active item is on `--fanous-c-drawer-active-bg` /
`--fanous-c-drawer-active-text` with a 3px indicator on its inline-start edge. On phones the drawer
opens from the inline-start side, as a `<dialog>` or with a backdrop, and closes on Escape.

Section headings in the drawer and rail are short nouns. The personal section (Library, History,
Watch later, Liked videos) is **"Yours" / «لك»**, never "You" / «أنت» (owner review, revision 4).
The same wording applies wherever that heading appears (the videos drawer and rail, Studio, the
native apps).

## Checks

- Theme visibility: every theme × light/dark × en/ar, with the account menu open. Videos:
  `apps/web/e2e/themes`. www: `e2e/theme-sweep.spec.ts`. CMS/Auth: their sweep specs.
- E2E: the account button shows the name, not the email, when a name exists. The menu sections
  come in the order above. The current account is shown only in Who; "More accounts" lists the
  others, each with its sign-out icon button. The current app is not in "Al Ummah Now apps", and
  every app entry shows its icon. The menu has no Upload; the header's Upload sits in the action
  cluster.

## Menus never leave the screen

Owner bug, 2026-11-13: on www on a phone the theme menu opened outside the screen. When a header wraps
(landscape phones, tablets, Arabic) a menu anchored to its button's edge can start or end past the
viewport, and at landscape heights run past the bottom. Rule: **no menu, popover, dropdown, list of
suggestions or tooltip ever renders outside the viewport.**

- Popups placed by a library with collision handling (Radix menus and selects in the videos web) and
  popups with their own placement (the videos web's `MenuButton`, the player's settings menu) keep it.
- Every hand-placed popup calls `fitToViewport` after it opens: it shifts the popup sideways (CSS
  `translate`) to keep an 8px gutter, narrows it when wider than the screen, and keeps it below its
  anchor when it fits; otherwise, when there is more room above the anchor, it opens upwards. Its
  height is capped to the room on that side (the popup scrolls inside), never with a minimum height,
  measured against the visual viewport (an on-screen keyboard counts). It re-fits when its own size
  changes (results arriving after it opened) and on resize. Source:
  `packages/fanous-tokens/nav/menu-fit.js` (videos web via `useFitToViewport`, videos admin);
  www `src/scripts/menu-fit.ts` and CMS `src/admin/client/dom.ts` carry the same function.
- Tests: each app has an E2E that opens its menus at 320, 375 and 414 px wide and a landscape phone
  (844×390), in English and Arabic, and checks every popup's box lies inside the viewport.
