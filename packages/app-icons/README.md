# @al-ummah/app-icons

Favicon and app-icon sets for every Al Ummah Now web app, generated from one SVG family built on
the Fanous lantern ([APP-ICONS.md](../../docs/native-apps/fanous/APP-ICONS.md),
[ICONOGRAPHY.md](../../docs/native-apps/fanous/ICONOGRAPHY.md)). Colours come from
`packages/fanous-tokens/tokens/fanous.tokens.json`.

| App | Repo / path | Tile | Glyph |
|---|---|---|---|
| `www` | AlUmmahNowUI `public/` | night, rounded | lantern (the base mark) |
| `videos` | AlUmmahNow `apps/web/public/` | lantern orange, rounded | play |
| `auth` | AlUmmahNowAuth `apps/auth` (served from code) | parchment, rounded, outlined | pointed-arch keyhole |
| `profile` | AlUmmahNowAuth `apps/profile` (served from code) | teal, rounded | eight-point star (geometric avatar) |
| `videos-admin` | AlUmmahNow `apps/admin-web/public/` | ink octagon, gold ring | play |
| `cms` | AlUmmahNowCMS (served from code) | ink octagon, gold ring | lantern (it edits www) |
| `auth-admin` | AlUmmahNowAuth `apps/admin/public/` | ink octagon, gold ring | star (it manages accounts) |

Staff tools always use the octagonal seal with a gold ring, so they never look like a public site
in a row of tabs. No faces or figures, no calligraphy or sacred text.

Each set has `favicon.svg` (light and dark palettes inside, switched by `prefers-color-scheme`),
`favicon-qa.svg` and `favicon-stage.svg` (a violet or pink corner dot; apps pick one at request time
because stage and production share a build), `favicon.ico` (16/32/48, PNG entries),
`apple-touch-icon.png` (180, opaque), `icon-192.png`, `icon-512.png`, `icon-maskable-512.png`
(glyph inside the 80% safe zone) and `site.webmanifest`.

Link tags:

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><!-- -qa / -stage off production -->
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

## Regenerate

```bash
pnpm install --filter @al-ummah/app-icons
pnpm --filter @al-ummah/app-icons build --app videos --out apps/web/public --legacy-png
pnpm --filter @al-ummah/app-icons build --app videos-admin --out apps/admin-web/public
pnpm --filter @al-ummah/app-icons build --app www --out ../AlUmmahNowUI/public/icons --base /icons/
pnpm --filter @al-ummah/app-icons build --app cms --format ts --out ../AlUmmahNowCMS/src/lib/app-icons.generated.ts
pnpm --filter @al-ummah/app-icons build --app auth --format ts --out ../AlUmmahNowAuth/apps/auth/src/app-icons.generated.ts
pnpm --filter @al-ummah/app-icons build --app profile --format ts --out ../AlUmmahNowAuth/apps/profile/src/app-icons.generated.ts
pnpm --filter @al-ummah/app-icons build --app auth-admin --out ../AlUmmahNowAuth/apps/admin/public
pnpm --filter @al-ummah/app-icons build --sheet contact-sheet.html   # review every app side by side
```

`--format ts` writes one module mapping each path to its content type and base64 body, for
Workers without static assets. Paths are resolved against the directory you run pnpm from.
