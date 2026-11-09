# Research: modern video sites and dark-UI products

Captured 2026-11-08 from live pages, signed out, at 1440px and 390px. Measurements come from computed styles.
Screenshots of third-party sites are not committed.

## What could be seen

| Site | Seen first-hand | Not available |
|---|---|---|
| YouTube | Home shell, channel, search, watch page layout | Player (sign-in bot wall), Studio and upload (needs an account) |
| Vimeo | Marketing home, Staff Picks | Watch page (Cloudflare check) |
| Twitch | Home, browse, live player | Creator dashboard |
| Kick | Home, browse, live player | Creator tools |
| Netflix, Apple TV, Disney+ | Signed-out marketing pages | Catalogue and player (subscription) |
| Nebula | Home, videos catalogue | Player (subscription) |
| Dailymotion | Home | |
| Rumble | Nothing | Blocked by a security check |
| Linear, Arc, Raycast | Marketing pages, product shown in them | |

Security checks were not bypassed. Player findings rest on Twitch, Kick and general knowledge of the
other players, and are marked where they are not first-hand.

## Measured

| | Header | Side nav | Card radius | Primary button | Borders |
|---|---|---|---|---|---|
| YouTube | 56px | 240px, grouped, 72px rail | 10–20px thumbnails | 20px pill, 40px tall | Almost none, separates with space |
| Twitch | 50px | 232px live list, collapses | 4–6px, pills 9000px | Pill, 32px tall | 1px rgba(83,83,95,.55) |
| Kick | 56px | Grouped, then recommended | 8px top, 12px bottom | 4px radius, 36px | 1px white at 15% |
| Nebula | 72px | Category list | 12px | Pill, 32px | 1px at 10% to 25% |
| Netflix | 88px | None | 4–8px | 4px radius, 56px hero | 1px grey at 70% on inputs |
| Dailymotion | 65px | Grouped | 8–16px | 12px radius, 40px | 1px rgb(43,43,43) |
| Linear | 73px, blur 20px | Product only | 8–12px | Pill, 32px | 1px white at 5–8%, plus inset 1px white at 5% |
| Raycast | | | 6–12px | | 1px white at 20%, multi-layer shadow |

## Patterns

**Navigation.** Items come first, grouped under short headings: where you are, what you follow, your
library, then more. Theme and language are never above the navigation. On YouTube they sit in the
overflow or account menu. Kick has one small icon in the header. A 72px rail is the collapsed state on
desktop, and phones use a bottom bar or a drawer.

**Depth comes from layers, not boxes.** Linear pairs a very low-alpha hairline with a 1px inset
highlight, so edges read as light on an edge. Raycast stacks three or more shadows. Overlays use 16–48px
backdrop blur. Flat fills with one soft grey shadow appear on none of the strongest products.

**Gradients have jobs.** Scrims make text legible over media (Twitch, Nebula, Apple TV, Netflix).
Atmospheric radial light sits behind heroes (Netflix uses a 149deg two-colour wash and radial pools).
Raycast uses a bright gradient on a single element. None of them put gradients on every surface.

**One accent, used once per view.** Kick's green, Netflix's red and Nebula's blue each mark one action.
Everything else is neutral or ghost.

**Video cards are the thumbnail.** Thumbnail, then avatar, title and meta on the page itself with no
card chrome (YouTube, Nebula, Twitch). Hover reveals depth or a preview. Duration sits on the thumbnail.

**Channel pages** lead with a banner, identity row and one Subscribe action, then underlined text tabs.

**Search** is the header's centre on YouTube, Twitch, Kick and Dailymotion.

## Adopt

- Nav items first, grouped with headings. Theme and language are small icon controls at the foot of the drawer and in the account menu.
- A 72px rail on desktop and a full drawer on phone. Centre search in the header.
- Layered edges: a hairline plus an inner highlight, in each theme's own colours.
- Cards without boxes on browse pages. Containers only for forms and settings.
- Exactly one primary action per view, in the theme's material.
- Scrims on media. Atmospheric radial light behind heroes.
- A pill or a consistent radius family per theme. Header controls share one height.

## Avoid

- Theme or language controls with the visual weight of navigation.
- Grey box shadows under identical rounded cards.
- Gradient washes on everything. Each gradient must have a job.
- Marketing-page scale in the product (Netflix's 88px header and 56px buttons).
- Neon single-hue accents, which do not fit this brand.
