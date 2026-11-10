# Fanous app icons, splash and store art (Epic 10.6)

A brief for the designer. The sizes are in [`app-icon-matrix.json`](./app-icon-matrix.json).

## Why these are not generated from the current logo

`apps/web/public/logo.png` is a 1000 x 1000 painted raster, and the store assets cannot be derived
from it faithfully:

| Limit | Effect |
|---|---|
| 1000 px wide | iOS, macOS and Play masters need 1024 px, and store art up to 4640 px. Enlarging invents detail. |
| Circular crop with transparent corners | iOS icons must be opaque and full-bleed. Filling the corners means repainting the sky. |
| One flattened image | Android adaptive icons need separate foreground and background, tvOS needs 2 to 5 parallax layers. |
| Fine lattice and soft bokeh | Detail collapses at 16 to 48 px. Small sizes need a simplified lantern drawing. |

Also needed from the owner: confirmation that the brand holds full commercial rights to the artwork
and how it was produced, because store submission asserts those rights. A vector redraw removes the
question for all derived assets.

## What the designer delivers

1. **Master lantern, vector:** geometric redraw of the existing lantern, faithful to its silhouette
   (dome, finial, hexagonal body, arched lit panels). No figurative elements.
2. **Layers kept separate:** sky background (`nightDeep` to `night`), lantern body, lit panels and glow.
3. **Small-size master:** simplified drawing for 48 px and under, with no lattice detail.
4. **Monochrome glyph:** one colour, for Android themed icons, Windows and notification icons.
5. **Wordmark:** Arabic and Latin lockups. Depends on decisions D6 (font) and D8 (naming).
6. **Every asset in the matrix**, exported from the masters.

## Platform rules

- **iOS, iPadOS:** one opaque 1024 master, no transparency or pre-rounded corners. Provide dark and
  tinted variants.
- **macOS:** rounded-rectangle shape with the standard margin, as an `.icns` set.
- **tvOS:** layered image stack (2 to 5 layers), keeping the lantern within the safe area for parallax.
- **Android:** adaptive icon on a 108 dp canvas, key art within the central 66 dp, plus monochrome layer.
- **Android TV, Google TV:** 320 x 180 dp banner, wordmark legible at 10 feet, Arabic and Latin variants.
- **Windows:** MSIX assets with transparent backgrounds and `targetsize` unplated icons.
- **Linux:** hicolor sizes plus scalable SVG and a `-symbolic` glyph.
- **Tizen, webOS:** confirm sizes against the current Samsung and LG store guidance at submission.

## Splash

Background `night` in dark and `parchment` in light, centred lantern at most 40% of the short edge,
no text. The glow pulse uses `motion.duration.glowPulse` and is static under reduced motion.

## Acceptance

- Reviewed at actual size on a device for each platform, and on a 10-foot screen for TV.
- Passes each store's validator with no warnings about transparency or dimensions.
- No figurative imagery. Source files are delivered and the rights are assigned to the brand.

## Web favicons

Every web app (www, videos, videos admin, CMS, sign-in, account, accounts admin) and the desktop
tools use the owner's art as is: the logo for www, and the owner's Magnific renders for the others.
Each is cropped to a square and downscaled by
[`packages/app-icons`](../../../packages/app-icons/README.md), with no overlays or edits.
