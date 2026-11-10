# @al-ummah/app-icons

Favicons and app icons for every Al Ummah Now app. The art is the owner's: the logo for www, and the
owner's Magnific (Freepik) renders for the others. It is used **as is**: each source is cropped to
a full-bleed square, and every size, 16 px included, is a straight downscale of that crop. Nothing is
drawn, recoloured or overlaid on production icons.

| App | Source | Served from |
|---|---|---|
| `www` | the logo (AlUmmahNowUI `public/brand/alummah-now-logo.png`) | AlUmmahNowUI `public/` |
| `videos` | `setC-videos-magnific-v1.png` | AlUmmahNow `apps/web/public/` |
| `auth` (sign in) | `setC-signin-keyhole.png` | AlUmmahNowAuth `packages/ui/src/app-icons/auth.generated.ts` |
| `profile` (account) | `setC-account-flat-silhouette.png` | AlUmmahNowAuth `packages/ui/src/app-icons/profile.generated.ts` |
| `videos-admin` | `setC-staff-ring-octagon.png` | AlUmmahNow `apps/admin-web/public/` |
| `cms` | `setC-cms-qalam.png` | AlUmmahNowCMS `src/lib/app-icons.generated.ts` |
| `auth-admin` | `setC-staff-double-octagon.png` | AlUmmahNowAuth `apps/admin/public/` |
| `tools` | `setC-staff-ring-octagon.png` | AlUmmahNowTools `*/app-icon.ico` |

The crops live in `assets/crops/<app>.webp` (512 px, lossless), so the sets can be rebuilt without the
originals.

Each web set has:
- `favicon.ico` (16/32/48) and `favicon.svg` (the 64 px downscale wrapped in SVG)
- `favicon-qa.svg` and `favicon-stage.svg`, the same with a violet or pink corner dot, which apps pick
  per request on non-production hosts (stage and production share a build)
- `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` and `site.webmanifest`

There is no maskable icon: that would mean padding the art. Tools gets a Windows `.ico` from 16 to 256 px.

```html
<link rel="icon" href="/favicon.ico" sizes="32x32">
<link rel="icon" href="/favicon.svg" type="image/svg+xml"><!-- -qa / -stage off production -->
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

## Cropping

Magnific renders a rounded, bevelled tile centred on a wide canvas. `crop` finds the tile's outer
square from its edges, walks each corner's diagonal to where the frame ends, and keeps the largest
square that holds no frame. A square image without a frame is kept whole; the logo keeps its round
photo on a transparent square.

To change an app's art, drop a file named `setC-<app>-<anything>.png` into the candidates folder
(`<app>` is an id from the table, or `signin`, `account`, `accounts-admin`). A file newer than the
mapped one replaces it. Then crop and rebuild.

## Regenerate

From the AlUmmahNow root, with the sibling repos checked out next to it:

```bash
pnpm --filter @al-ummah/app-icons build crop --candidates ../icon-candidates --logo ../AlUmmahNowUI/public/brand/alummah-now-logo.png
pnpm --filter @al-ummah/app-icons build --app videos --out apps/web/public --legacy-png
pnpm --filter @al-ummah/app-icons build --app videos-admin --out apps/admin-web/public
pnpm --filter @al-ummah/app-icons build --app www --out ../AlUmmahNowUI/public/icons --base /icons/   # then move favicon.ico to public/
pnpm --filter @al-ummah/app-icons build --app cms --format ts --out ../AlUmmahNowCMS/src/lib/app-icons.generated.ts
pnpm --filter @al-ummah/app-icons build --app auth --format ts --out ../AlUmmahNowAuth/packages/ui/src/app-icons/auth.generated.ts
pnpm --filter @al-ummah/app-icons build --app profile --format ts --out ../AlUmmahNowAuth/packages/ui/src/app-icons/profile.generated.ts
pnpm --filter @al-ummah/app-icons build --app auth-admin --out ../AlUmmahNowAuth/apps/admin/public
pnpm --filter @al-ummah/app-icons build --app tools --format ico --out ../AlUmmahNowTools/AlUmmahNow.DataImporter/app-icon.ico   # and the other tools
pnpm --filter @al-ummah/app-icons build --sheet contact-sheet.html   # every app at 512/180/64/32/16 and in tab bars
```

Paths resolve against the directory you run pnpm from.
