# Navigation: one header, one account menu (all apps)

Status: adopted 2026-11-12. Applies to the videos web (`apps/web`), the videos admin
(`apps/admin-web`), www (AlUmmahNowUI), the CMS (AlUmmahNowCMS), the profile app and the auth
admin (AlUmmahNowAuth).

Fixed by earlier decisions and not reopened here:
- every app follows the admin-chosen site theme (Fanous: fawanees, lantern, zujaj, nahas; light and dark);
- the header is dark in every theme and mode;
- destructive actions confirm in an in-app dialog, never a browser prompt.

## Shared code

The stacks differ (Astro, Next.js/React, Hono JSX, a string-template Worker, React Router), so what
every app shares is a **framework-free CSS + markup contract**, not a component:

- `packages/fanous-tokens/nav/aun-nav.css`: the canonical stylesheet. It uses Fanous tokens only
  (`--fanous-c-nav-*`, `--fanous-c-menu-*`, `--fanous-c-divider-line`, `--fanous-color-*`,
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
inline end. Sections, top to bottom, with `.aun-menu-sep` separators between them:

1. **Who** (`.aun-menu-who`): a large avatar, the name, and the email muted under it. Apps may add
   one context line: the CMS role, or the videos active channel.
2. **Your accounts** (`.aun-menu-label`), shown when the browser has 2 or more accounts. An app
   whose menu also switches channels (videos) may open this list in place behind a "Switch
   account ›" row; the rows look the same. Each row is `.aun-acct-row`:
   - the entry: avatar, name and email;
   - the current account is `aria-current="true"`, with a `.aun-menu-check` mark and the muted
     line "Current account";
   - any other account is a button, "Switch to {name}";
   - each row ends with a small `.aun-acct-signout` "Sign out" button, which confirms first.
3. **Add another account**.
4. **This app** (no label): the app's own entries, at most four. Videos: switch channel, Studio,
   Settings, Write article (scholars). Profile: Manage sessions.
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
   `apps/web/src/lib/navigation/app-links.ts`.

6. **Sign out**: "Sign out" signs this account out. With two or more accounts, "Sign out of all
   accounts" (`.aun-menu-item--danger`) follows it and asks first in the in-app dialog.

## Menu surface (every menu from the header: account, theme, launcher, create)

| Property | Value |
|---|---|
| Background / text / muted | `--fanous-c-menu-bg` / `--fanous-c-menu-text` / `--fanous-c-menu-muted` |
| Border | 1px `--fanous-c-menu-border` |
| Radius | `--fanous-radius-md` (8px). Items use `--fanous-radius-sm` (4px) |
| Shadow | `--fanous-elevation-medium` |
| Padding | `--fanous-spacing-xs` (4px) |
| Width | 16rem min, 20rem max |
| Item | 2.75rem min height (touch target), `--fanous-spacing-md` inline padding, 0.9375rem text, 1.125rem icon in muted |
| Section label | 0.75rem, weight 600, muted, never upper-cased (Arabic) |
| Separator | 1px `--fanous-c-divider-line`, edge to edge |
| Hover / pressed | `--fanous-c-menu-hover` |
| Focus | 2px `--fanous-color-focus-ring` outline, inset 2px |
| Current / checked | `--fanous-c-menu-hover` fill, weight 600, `.aun-menu-check` at the end |
| Danger | `--fanous-color-error-text` |
| Phone (≤ 30rem) | a sheet under the header: full width less 8px each side, scrolls inside |

Keyboard: ↓ on the button opens and focuses the first item; ↑/↓ move, Home/End jump; Escape
closes and returns focus to the button. A click outside or tabbing out closes it.

RTL: logical properties only. Directional icons (back, chevron, sign-out arrow) carry `.aun-flip`.

## Drawer and side rail

These keep each app's layout (the videos left navigation, the admin groups, the CMS rail). They
use `--fanous-c-drawer-*`, with the active item on `--fanous-c-drawer-active-bg` /
`--fanous-c-drawer-active-text` and a 3px indicator on its inline-start edge. On phones the drawer
opens from the inline-start side, as a `<dialog>` or with a backdrop, and closes on Escape.

## Checks

- Theme visibility: every theme × light/dark × en/ar, with the account menu open. Videos:
  `apps/web/e2e/themes`. www: `e2e/theme-sweep.spec.ts`. CMS/Auth: their sweep specs.
- E2E: the account button shows the name, not the email, when a name exists. The menu sections
  come in the order above. The current app is not in "Al Ummah Now apps".
