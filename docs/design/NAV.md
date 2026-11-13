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

Height 3.5rem (`--aun-header-height`), background `--fanous-c-nav-bg`, bottom border
`--fanous-c-nav-border`. In reading order (it mirrors in Arabic):

1. Drawer toggle: only apps with a side rail or drawer (videos, admin, CMS, auth admin).
2. Brand: the owner's logo (round, 2rem), the wordmark "Al Ummah Now" / "الأمة الآن", and in
   tool apps a second line naming the app ("Content", "Admin", "Profile"). The logo is the
   owner's art as supplied, never a placeholder icon.
3. The app's own primary links or search (www links, the videos/CMS search, the admin ⌘K search).
4. **Action cluster**, at the inline end with the account button, never beside the logo (owner
   review, revision 5). App actions sit here in this order: Upload (videos: a "+ Upload" pill,
   2.5rem tall like the account button, `--fanous-c-nav-*` colours; icon-only "+" at 44px on
   phones, the name kept as its accessible name), notifications, then the account. CMS: New.
5. Language switch (`.aun-lang`): the other language's name ("العربية" / "English").
6. Theme switch (`.aun-icon-btn`): a menu with System / Light / Dark.
   Apps with a side rail (videos, videos admin, CMS, auth admin) put 5 and 6 at the foot of the
   rail or drawer instead, so the phone header keeps room for search and the account.
7. Account button (`.aun-acct-btn`), or "Sign in" when signed out (a solid button, never hidden
   inside a menu).

There is one sign-out entry, inside the account menu. The header has no separate "Log out" button.

## Account button

`<button class="aun-acct-btn" aria-haspopup="menu" aria-expanded aria-controls>`:

- `.aun-avatar`: the profile photo, else the first letter of the name on `--fanous-color-primary`.
- `.aun-acct-name`: the **display name**, chosen by the platform rule
  (`packages/shared-types/src/display-name.ts`, mirrored in Auth `packages/ui/src/display-name.ts`):
  1. the display name in the page language;
  2. the plain display name;
  3. first + last name;
  4. a name in the other language;
  5. `@handle`;
  6. the email, only when there is nothing else.
- `.aun-caret`.
- Pill shape (`--fanous-radius-full`), 2.5rem tall, 1px `--fanous-c-nav-search-border`. Hover
  and open use `--fanous-c-nav-hover`. Focus is a 2px `--fanous-c-nav-active-text` ring.
- Phone (≤ 30rem): the name is visually hidden but stays the accessible name. The button shows
  the avatar and the caret.

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

`<div class="aun-menu-context" role="group" aria-labelledby="…">`, label **Channel** / **القناة**, then
in this order:

| Row | What | When |
|---|---|---|
| Current channel (`.aun-menu-context-current`) | avatar + name, crown on the main channel, a `.aun-badge` role chip when the account is not the owner ("Channel admin"); links to the channel | a channel is active |
| "No active channel" (muted, not a link) | | no channel is active |
| **Switch channel ›** | opens the switcher in place (below) | always (an account without channels can still choose "Use without a channel") |
| **Studio** | the creator home, on the active channel | the account has at least one channel |
| **Create channel** | opens the switcher with the create form | the account has no channel yet and may create one |

**Switcher view** (in place, a back row "‹ Switch channel" at the top):
1. "Your channels" (`.aun-menu-label`): the account's own channels; the active one checked (`aria-checked`, `.aun-menu-check`).
2. "Channels you manage": channels where the account holds a role, each with its `.aun-badge`.
3. "Use without a channel".
4. **Create channel** (`.aun-menu-form` with `.aun-menu-input`), only while the tier allows another channel.
   At the tier's limit (`channel_limit`: `channelsOwned >= maxChannels`), the row is replaced by
   a `.aun-menu-note` "You can own up to {max} channels". A create the server refuses for the
   limit (another tab used it up) reads the tier again, closes the form and shows the same note,
   never a generic error. Without a creator tier (by invitation) there is neither Create nor the note.

Upload is **not** in the menu (owner review, revision 5, the YouTube pattern): the channel layer
leads to Studio, and uploading starts from the header's "+ Upload" action (see [Header](#header)),
which targets the active channel and is disabled with "Create a channel to upload" when no channel
is active.

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
