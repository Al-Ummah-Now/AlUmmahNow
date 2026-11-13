# Fawanees: light palette and the lantern street

Status: approved by the owner on 2026-11-13 ("go ahead with Fawanees"), after four review rounds.
Review page with the renders: https://claude.ai/artifact/LHegZefDiNbujfz7N5PCYh (private, owner's).

## Owner decisions

- No gradient backgrounds. The page, hero, cards, rail, menus and buttons are flat colours.
- Gold is light, not paint: primary buttons (with a soft lantern-glow halo), the lantern marker on
  the active item, focus rings, link text, hints such as "Featured", and the lantern windows. It never
  fills a surface.
- Depth from hairlines and warm shadows: page, card and chip are three clear levels.
- Nothing shows through a control: every control and text block sits on a solid surface.
- The lantern street, in light and dark, on every site. No lantern is ever cut by an element edge.
- The header stays dark in every theme and mode. No environment's active theme changes with this.

## Light palette (Fawanees 1.2.0; dark unchanged)

| Role | Value |
|---|---|
| Page | `#f3eee5` |
| Card surface | `#fffdf9` |
| Raised (fields, dialogs) | `#ffffff` |
| Neutral tint (selected row, menu hover) | `#ebe4d6` |
| Text / secondary / muted | `#16232b` / `#35434b` / `#4b5860` |
| Link | `#7a4300` |
| Primary / on primary | `#f4ae3a` / `#09151e` |
| Accent | `#9a5200` |
| Outline / divider | `#7a7468` / `#e4ded3` |

Every text colour passes 4.5:1 on every surface it can sit on (accent counted as text; lowest
4.64:1), and every UI pair 3:1 (lowest 3.67:1).

## The street

Two layers:

- **Near: garlands of whole lanterns.** The shared module (`packages/fanous-tokens/street`)
  measures the page (cards, images, controls, text) and hangs a garland in each real free gap:
  between rows and sections that span most of the content width, and down wide side margins.
  Lanterns are sized to fit, so nothing can sit in front of one. They scroll with the page.
- **Far: soft distant lights.** A tile of blurred warm lights in the page background, moved at
  0.2× the scroll by a scroll-driven animation. Soft dots have no edge to cut, and they keep even
  the 16 px phone gutters alive.

Reduced motion: the lights stand still and the lanterns stop swaying. Browsers without
scroll-driven animations show the lights still.

Where it does not draw: inside cards, menus and controls, and where an app paints its own opaque
frame around the content (Studio's work area, which stays plain as a work tool).

The street option needs room: with the street on, the apps widen the gaps between rows and
sections enough for a garland (videos home: 92 px between rows on desktop, 76 px on phones).

### Why it is not a background pattern

Round 3 drew the street as a repeating background. A pattern behind the page is always sliced
where a card edge crosses a lantern, and on a phone the cards cover 82–88% of the page, so the
lanterns landed behind cards and phones looked empty. Measuring the page and hanging lanterns only
in the gaps fixes both.

## Per app

| App | Dark mode signal | Integration |
|---|---|---|
| Videos web (AlUmmahNow `apps/web`) | `html.dark` | `FanousStreet` component; `src/theme/fawanees.css` makes the watch pills, details and comment sort opaque, makes the watch block, comments and related videos cards, and gives garlands room |
| Videos admin (`apps/admin-web`) | `html.dark` | `FanousStreet` component |
| www (AlUmmahNowUI) | `html[data-mode]` or the system setting | vendored module; timeline gaps widened on phones |
| CMS (AlUmmahNowCMS) | `html.dark` | vendored module |
| Sign-in, profile, accounts admin (AlUmmahNowAuth) | the system setting | vendored module; the sign-in root wrapper becomes transparent |

## Checks

- Theme package: `pnpm themes:check`, `pnpm check:tokens`, the theme-packages tests (lightStyle,
  street tokens and their validation).
- Videos web, Theme visibility suite (`apps/web/e2e/themes`): `pages.spec.ts` (pixels and axe in
  every theme, mode and language) and `street.spec.ts` (no see-through controls, every lantern on
  screen drawn whole, street present, other themes draw none, Studio stays plain, reduced motion
  still). Visual snapshot tests stay pinned to Lantern.
