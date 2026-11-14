# Fanous lantern street (shared module)

One module for every Al Ummah Now app. It draws the lantern street when the active theme switches
it on (theme package `street` section; Fawanees). Design record: `docs/design/FAWANEES-STREET.md`.

| File | What |
|---|---|
| `fanous-street.js` | Plain JavaScript, no dependencies. `startStreet()` starts it and keeps it in step with the layout, theme and mode; returns a stop function. `renderStreet()` draws once (tests). |
| `fanous-street.css` | The far-lights layer (moved 0.2× the scroll by the module; still with reduced motion), body isolation, the garlands' colours from the theme tokens, print. No CSS animations. |
| `fanous-street.d.ts` | Types for TypeScript importers. |

## Include it

1. The theme's tokens: the app's theme stylesheet must carry the `--fanous-street-*` tokens of the
   active theme and mode (the videos site's `site-themes.css` does; www and the CMS vendor them).
2. `fanous-street.css` after the theme stylesheet.
3. Call `startStreet()` once on the client after the page loads (the videos apps use a
   `FanousStreet` component in the root layout).
4. Send `<html data-fanous-street-variant="N">` in every HTML response, with
   `N = pickStreetVariant(request.headers.get('cookie'))`: the server picks one of the theme's tile
   variants at random per response, so the page never swaps after paint and there is no inline
   script. A dynamic page sets it while rendering (videos web and admin: the root layout). An
   edge-cached page must not bake one variant into the cached copy: it sets the attribute after the
   cache read with `HTMLRewriter`, per response. Visual tests pin a variant with the cookie
   `aun_street_variant=<1-4>` (`STREET_VARIANT_COOKIE`).

Inside this monorepo, import both files by relative path. Other repos vendor them at a pinned
commit with their `sync-fanous` script, like the theme tokens.

## Page hooks

- `data-fanous-street-region` on the element whose free space may hold lanterns (default:
  `#main-content`, then `main`, then `body`).
- `data-fanous-street="off"` on an element that must stay plain.
- An area whose ancestor paints an opaque background (an app's own frame) gets no lanterns.
- An app that paints its page colour on a wrapper (not `html` or `body`) makes that wrapper
  transparent under `html.fanous-street` in its own stylesheet.

## Each app keeps

- Controls and text blocks opaque (the street must never show through one).
- Room for garlands: gaps between rows and sections of about 60 px (desktop) and 48 px (phone) at
  least, under `html.fanous-street`.
