# @al-ummah/app-icons

Favicons and app icons for every Al Ummah Now app. The art is the owner's: the logo for www, and the
owner's Magnific (Freepik) renders for the others. It is used **as is**: each source is cropped to
a full-bleed square, and every size, 16 px included, is its own Lanczos downscale of that crop. Nothing is
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
- `favicon.ico` (16/32/48) and `favicon-16x16.png`, `-32x32`, `-48x48`, `-96x96`: each size its own
  downscale, so the browser picks an exact size and never shrinks the art itself
- `favicon-qa.svg` and `favicon-stage.svg`: the art (a 128 px image) with a violet or pink corner
  dot, which apps pick per request on non-production hosts (stage and production share a build)
- `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png` and `site.webmanifest`

There is **no production `favicon.svg`**. Browsers prefer an SVG over sized PNGs and then shrink the
image inside it with a soft filter, which blurred the 16 px tab (2026-11-11). There is no maskable
icon: that would mean padding the art. Tools gets a Windows `.ico` from 16 to 256 px.

Production links the ICO and the sized PNGs:

```html
<link rel="icon" href="/favicon.ico" sizes="16x16 32x32 48x48">
<link rel="icon" type="image/png" sizes="16x16" href="/favicon-16x16.png">
<link rel="icon" type="image/png" sizes="32x32" href="/favicon-32x32.png">
<link rel="icon" type="image/png" sizes="48x48" href="/favicon-48x48.png">
<link rel="icon" type="image/png" sizes="96x96" href="/favicon-96x96.png">
<link rel="apple-touch-icon" href="/apple-touch-icon.png">
<link rel="manifest" href="/site.webmanifest">
```

QA and stage link the ICO and the dot SVG instead of the PNGs (the SVG wins, so the dot shows).
Where a page can link only one icon (the sign-in page's theme), production uses `/favicon.ico`.

## Cropping

Magnific renders a rounded, bevelled tile centred on a wide canvas. `crop` finds the tile's outer
square from its edges, walks each corner's diagonal to where the frame ends, and keeps the largest
square that holds no frame. A square image without a frame is kept whole; the logo keeps its round
photo on a transparent square.

Then `FRAMING` in `src/crop.ts` (the owner's choice, 2026-11-11) tightens some apps so the mark
reads in a 16 px tab. It is a square inside the frame-free one, as fractions of it:

| App | Framing |
|---|---|
| `videos` | the lit windows with the play button |
| `auth` (sign in) | the lantern with its keyhole; sky and finial trimmed |
| `profile` (account) | the lantern body and dome; sky trimmed |
| `cms` | the lantern with its pen; sky trimmed |
| `videos-admin`, `auth-admin`, `tools`, `www` | the whole square (the octagon frame is the admins' mark) |

To change an app's art, drop a file named `setC-<app>-<anything>.png` into the candidates folder
(`<app>` is an id from the table, or `signin`, `account`, `accounts-admin`). A file newer than the
mapped one replaces it. Then crop and rebuild.

## Regenerate

From the AlUmmahNow root, with the sibling repos checked out next to it:

```bash
pnpm --filter @al-ummah/app-icons build crop --candidates ../icon-candidates --logo ../AlUmmahNowUI/public/brand/alummah-now-logo.png
pnpm --filter @al-ummah/app-icons build --app videos --out apps/web/public
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
