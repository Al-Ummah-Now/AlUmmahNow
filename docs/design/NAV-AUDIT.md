# Navigation audit (2026-11-12)

For owner review. Nothing is implemented on `main` yet. The spec is [NAV.md](NAV.md).

- **Audit page** (screenshots of every app's header and account menu, desktop and phone, en and ar,
  signed out and with two accounts, plus a table of the differences):
  https://claude.ai/artifact/Nxqs8XbwAReNP7LdGwKBSR
- **Mockups of the proposal**, rendered from a local build with mock data: the header, the account
  menu with the videos channel layer, the channel switcher and the drawer, in Lantern and Fawanees,
  light and dark, en and ar, desktop and phone, plus the CMS, www and profile menus (base shape, no
  slot): https://claude.ai/artifact/N7DFfR3EeqMQkNMScterMS

## Owner review

- 2026-11-12: "the account menu should follow the bg colors". Menus (with the channel layer) and the
  drawer now use the page's surface, background, text and divider tokens in each mode; only the
  header bar stays dark. Mockups re-rendered; contrast re-checked (videos theme specs 66 passed, CMS
  and profile axe 0 violations, www sweep 0 findings, token pairs ≥ 5.18:1).

- 2026-11-12, revision 3 ("I said bg color"):
  - In light mode the menus, the channel switcher and the drawer sit on the page **background**
    (`--fanous-color-background`; in Fawanees light the cream, not the gold surface). An outline
    border and a soft shadow separate them, and a light tint marks hover.
  - Dark mode is as before revision 2 (the theme's menu tokens).
  - Contrast: videos theme specs 98 passed (account menu, channel switcher, phone menu, every page
    with the rail, in 4 themes × light/dark × en/ar); CMS and profile axe 0 violations; www sweep
    0 findings.

- 2026-11-13, revision 4 ("in dark you can't see the lines between rows"):
  - Dark-mode separators are now the menu text mixed 30% into the menu: 1.91–2.49:1 on the menu
    in all four themes, against 1.00–1.39:1 before (Fawanees' divider was the menu colour itself).
  - Light mode is unchanged; the outer border is at least 3.24:1.
  - The Theme visibility check now fails a separator under 1.8:1 dark (1.25:1 light) or a border
    under 3:1.
  - The drawer and rail heading over Library, History, Watch later and Liked videos now reads
    **"Yours" / «لك»** (it was "You" / «أنت»). It appears only in the videos drawer and rail.

- 2026-11-13, revision 5 ("include all changes at once"), every outstanding item in one pass, in all
  apps (videos web + Studio, videos admin, www, CMS, profile, auth admin):
  - Accounts follow the Google pattern: the current account is shown once, in Who; "More accounts"
    / «حسابات أخرى» lists the others. Each row highlights as a whole and ends with a sign-out icon
    button ("Sign out of {name}", confirmed in-app). "Add another account" has a sign-in icon.
    The CMS links "More accounts" to its accounts page.
  - "Al Ummah Now apps" entries show each app's favicon (the owner's art, crop/resize only,
    embedded in the shared stylesheet as WebP).
  - Upload is no longer in the account menu (Studio only there). The header's Upload moved from
    beside the logo to the action cluster before notifications and the account: a "+ Upload" pill
    as tall as the account button on desktop, icon-only on phones.
  - Revision 4's dark separators and «لك» heading carry through.
  - Checks: videos theme specs 100 passed (plus channel layer 24/24); www 86 specs, sweep 0
    findings; CMS axe 0 violations in 32 combinations; profile axe 0 violations, vitest 104.

- 2026-11-13, revision 5 follow-up (the CMS menu, dark teal and brown: "the lines are nearly
  invisible"). The owner's screenshot was the CMS as deployed, before this work. The separator fix
  now applies to every app's menu, in both modes:
  - one shared rule: the menu's text mixed 35% into the menu's surface, light 1.97–2.10:1 and dark
    2.13–2.89:1 (light mode used the theme divider before, 1.31–1.77:1);
  - measured from the CMS renders: Lantern 2.02 / 2.40, Fawanees 2.10 / 2.53, Zujaj 1.97 / 2.13,
    Nahas 2.09 / 2.89 (light / dark);
  - a token test fails any theme or mode under 1.9:1 (border under 3:1), and the videos theme
    specs now require 1.9:1 in both modes (62 passed).

- 2026-11-13, revision 6 (owner review of the www and profile menus, applied to every app's menu:
  videos web and Studio, videos admin, www, CMS, profile, auth admin):
  - Lines: the menu text mixed 45% into the menu, 2.47–2.73:1 light and 2.60–3.81:1 dark (floor
    2.4:1 in the token test and the videos theme specs).
  - Each other account ends with a sign-out icon button with the label and tooltip "Sign out of
    {name}" / «تسجيل الخروج من {name}» (the profile app read "Sign out {name}").
  - Rows run edge to edge, so a row's highlight covers its sign-out button; the current account
    is a tinted panel across the menu's full width at the top.
  - "Sign in to another account" / «تسجيل الدخول بحساب آخر» with a sign-in icon.
  - App entries: each app's own favicon, as in revision 5 (see the correction below).
  - Polish: one 21rem width, a shared leading column, clearer section headers, emails that keep
    their domain, Latin names aligned in Arabic menus, and the videos admin's missing "Sign out"
    of the current account.
  - Found on the way: the CMS minifier dropped the space in "a :is(b)" selectors (fixed, and a
    test rejects the pattern); the auth server's own `/ui/account-switcher` page still has the old
    design (not one of the header menus; issue filed).

- 2026-11-13, revision 6 correction ("use icons we choose for favicons, not random ones"): the first
  revision 6 put drawn line icons on colour tiles in the "Al Ummah Now apps" entries, which went
  against the owner's rule. The entries are each app's own favicon again: its exact
  favicon-48x48.png (byte-identical to what the app serves), 24px in the menus and 48px on the
  profile app's "Your apps" cards, which now show the same images. Everything else in revision 6
  stays, and every revision 5 item is still in (checked in code and in the renders).

- 2026-11-13, revision 6 review (Fawanees dark and light, phone):
  - "Why is the name in a different colour?": the current account no longer sits on a tinted
    panel; it is on the menu's own background, separated only by the divider, in every app.
  - "Use the full favicons, cropped to a circle": app entries and the profile cards show each
    app's whole favicon (from its highest-resolution asset, icon-512.png, downscaled only) inside
    a circle the size of the account avatars (2rem; 3rem on the cards).

- 2026-11-13, delivery of the app icons: inlined in the shared stylesheet they made it 120 KB (the
  CMS module 250 KB), render-blocking on every page. They are now separate static files
  (`/aun-nav/icons/<id>.webp`, the same 96 px images) loaded lazily by the menus; the stylesheet is
  back to 16 KB. Rendering is the same: identical at 2x, at most 3/255 per channel at 1x (32 px).

## The differences found, in short

| Aspect | Today |
|---|---|
| Account button | Different in each app: avatar + name (www), avatar only (videos), "Accounts (2)" text plus a separate Log out (videos admin), the email's initial (CMS), avatar + email (profile), a coloured initial (auth admin) |
| Account menu order | Six different orders. Only www and the profile app link to the other apps |
| App names | "Al Ummah Now Videos", "Al Ummah Now", "Al Ummah Now (www)", "CMS", "Content management", "Auth Admin"… |
| Menu surface | 8 or 12px radius; Tailwind, hard-coded colours or tokens; items 28–44px; labels upper-cased in Arabic (profile) |
| Header | Dark everywhere except the auth admin (light card in light mode) and the profile app (surface gradient) |
| Brand | Placeholder sparkle in the videos admin and the CMS instead of the logo |
| Sign in (signed out) | A button on www, but inside an avatar menu in videos |
| Videos channels | At the channel limit "Create channel" silently disappears; a refused create says "Failed to create"; Upload is not in the menu. The open menu closes by itself when the session's channel cache is stale (#1058) |

## Shipped

The owner approved the design on 2026-11-13. The monorepo part merged as #1057 (with #1039 folded
in); www, the CMS and Auth followed with their own PRs and releases.
