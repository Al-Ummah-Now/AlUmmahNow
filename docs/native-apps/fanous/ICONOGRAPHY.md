# Fanous iconography and illustration (Epic 10.5)

A brief for the designer of the UI icon set and empty-state illustrations.

## Principles

- Geometric construction, inspired by Islamic pattern: stars, arches, lattices, built on a grid.
- **No figurative imagery** in brand art: no people, faces, animals or body parts. Replace the
  usual "user" silhouette with a monogram or a geometric avatar shape.
- Use no sacred text as a decorative element, and no calligraphy of the names of Allah or verses
  of the Quran in icons, since icons get resized, cropped and discarded.

## Grid and format

| Property | Requirement |
|---|---|
| Canvas | 24 x 24 units, live area 20 x 20, 2 unit padding |
| Stroke | 1.5 units, round joins and caps |
| Corner radius | 1 unit on outer corners |
| Styles | Outline (default), filled (selected state) |
| Colour | One colour, inherited from the theme (`textPrimary`, `accent`). No embedded colours. |
| Delivery | SVG, one file per icon, `name_style.svg`, flattened, no strokes-as-masks |
| 10-foot | Same glyphs drawn at 48 units or more. Check legibility at 3 metres. |

Export targets from the SVG source: SF Symbols template (Apple), Android vector drawable, Windows
`FontIcon` or SVG, GTK symbolic SVG (`-symbolic.svg`), Tizen PNG at 1x, 1.5x, 2x, inline SVG on web.

## RTL

Mirror icons that imply direction: back, forward, next, previous, reply, send, list indent,
progress, seek. Do not mirror: play, pause, clock, search, checkmark, logos, or media transport
icons that represent the physical tape direction, and confirm those per platform convention. Each
icon's metadata states `mirrorInRtl: true | false`.

## Minimum icon set

Navigation: home, search, library, Lamahat, live, profile, settings, back, forward, close, more.
Player: play, pause, seek back, seek forward, next, previous, volume, mute, captions, quality,
speed, fullscreen, picture-in-picture, cast, download, listen mode.
Actions: like, comment, share, save, subscribe, notify, report, edit, delete, upload, filter, sort.
Status: verified scholar, live, offline, downloaded, error, warning, success, lock (kids and parental).
Islamic layer: prayer times, qibla, calendar, mosque, study circle.

## Illustrations

Empty states (no results, offline, no downloads, no subscriptions, error, kids locked): geometric
compositions using the lantern, arches and stars, in `night`, `lantern` and `glow`, with a light
theme variant. SVG, no figurative elements, no embedded text so that they work in every locale.
Provide a static version; any animation uses the lantern-glow motif and stops under reduced motion.
