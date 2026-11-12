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
4. App actions (videos: Upload, notifications; CMS: New).
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
| 3 | Your accounts + Add another account | base | yes | yes ("Switch account ›" opens the list in place) |
| 4 | This app | base | the app's own entries (≤ 4) | Write article / My articles (scholars), Settings |
| 5 | Al Ummah Now apps | base | yes | yes |
| 6 | Sign out | base | yes | yes |

An app with nothing to put in the slot leaves it out, separator included. Its menu then has the
base shape exactly (www, CMS, profile, videos admin, auth admin).

1. **Who** (`.aun-menu-who`): a large avatar, the name, and the email muted under it. An app may
   add one muted line here (the CMS role). Who never shows the channel; that is the slot's job.
2. **Context slot** (`<div class="aun-menu-context" role="group" aria-labelledby>` with a
   `.aun-menu-label`): one app-specific layer, see [Context slot](#context-slot-the-videos-channel-layer).
3. **Your accounts** (`.aun-menu-label`), shown when the browser has 2 or more accounts. An app
   whose menu also has a context layer (videos) may open this list in place behind a "Switch
   account ›" row; the rows look the same. Each row is `.aun-acct-row`:
   - the entry: avatar, name and email;
   - the current account is `aria-current="true"`, with a `.aun-menu-check` mark and the muted
     line "Current account";
   - any other account is a button, "Switch to {name}";
   - each row ends with a small `.aun-acct-signout` "Sign out" button, which confirms first.

   **Add another account** follows the accounts.
4. **This app** (no label): the app's own entries, at most four. Videos: Write article, My
   articles (scholars), Settings. Profile: Manage sessions.
5. **Al Ummah Now apps** (label): links to the other apps the account may open, gated by role
   like each app's own guard. The current app is left out. The order and labels are fixed:

   | Order | English | Arabic | Who sees it |
   |---|---|---|---|
   | 1 | Website | الموقع | everyone |
   | 2 | Videos | المرئيات | everyone |
   | 3 | Your profile | ملفك الشخصي | everyone |
   | 4 | Content management | إدارة المحتوى | super_admin, admin, moderator, scholar |
   | 5 | Videos admin | إدارة المرئيات | super_admin, admin, moderator |
   | 6 | Accounts admin | إدارة الحسابات | super_admin, admin |

   The role gates mirror the profile app's catalog (AlUmmahNowAuth `apps/profile/src/apps.ts`),
   which mirrors each app's own access guard. Videos and admin-web share
   `packages/shared-types/src/app-links.ts`.

6. **Sign out**: "Sign out" signs this account out. With two or more accounts, "Sign out of all
   accounts" (`.aun-menu-item--danger`) follows it and asks first in the in-app dialog.

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
| **Upload** | the upload page for the active channel (`/upload?channel=<id>`) | a channel is active and the account may upload (creator tier) |
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

The header's own Upload button (beside the logo) stays: same target, disabled with "Create a
channel to upload" when no channel is active.

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
| Separators, role-chip border | `--fanous-color-divider` | `--fanous-c-menu-text` mixed 30% into `--fanous-c-menu-bg` (the theme's divider token is 1.0–1.4:1 on the dark menu, too faint) |
| Shadow | `--fanous-elevation-medium` | `--fanous-elevation-medium` |

| Property | Value (both modes) |
|---|---|
| Radius | `--fanous-radius-md` (8px). Items use `--fanous-radius-sm` (4px) |
| Padding | `--fanous-spacing-xs` (4px) |
| Width | 16rem min, 20rem max |
| Item | 2.75rem min height (touch target), `--fanous-spacing-md` inline padding, 0.9375rem text, 1.125rem icon in muted |
| Section label | 0.75rem, weight 600, muted, never upper-cased (Arabic) |
| Role chip (`.aun-badge`) | 11px, weight 600, pill, 1px separator border, muted text |
| Note (`.aun-menu-note`) | 13px, muted, item padding; why an action is missing |
| Focus | 2px `--fanous-color-focus-ring` outline, inset 2px |
| Current / checked | the hover fill, weight 600, `.aun-menu-check` (`--fanous-color-link`) at the end |
| Danger | `--fanous-color-error-text` |
| Phone (≤ 30rem) | a sheet under the header: full width less 8px each side, scrolls inside |

Contrast (computed from the tokens, every theme): light mode, text, muted, danger and the check on
the background and the hover tint are 5.10:1 or more; dark mode (the menu tokens) 4.69:1 or more.

Lines must show (owner review rev 4, "in dark you can't see the lines between rows"):

| Line | Light mode | Dark mode | Floor (checked) |
|---|---|---|---|
| Separators between sections | 1.31–1.77:1 on the background | 1.91–2.49:1 on the menu (Lantern 2.13, Zujaj 1.91, Nahas 2.49, Fawanees 2.23) | 1.25:1 light, 1.8:1 dark |
| Outer border | 3.57–5.12:1 on the background | 3.24–4.40:1 on the menu | 3:1 |

`apps/web/e2e/themes/account-menu.spec.ts` measures both in every theme × light/dark × en/ar
(`menuLineContrast` in `e2e/themes/harness.ts`), so a faint divider fails the Theme visibility check.

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
  come in the order above. The current app is not in "Al Ummah Now apps".
