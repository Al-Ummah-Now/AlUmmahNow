# Video player

**Status:** spec, 2026-11-09 · **Plan:** [VIDEO-PLAYER-PLAN.md](./VIDEO-PLAYER-PLAN.md) ·
**Theming input:** `docs/design/player-themes.md` on `proto/theme-demos` (per-theme values, shared rules).

One production player for the web app. It keeps the Video.js engine, takes the controls the owner liked
from the theme-demo prototype, keeps the production progress bar and quality menu the owner preferred,
and fixes every visual defect found in both. Every colour and surface comes from fanous-tokens, so each
theme gets its own player without code changes.

## 1. Decisions

| Topic | Decision | Source |
|---|---|---|
| Engine | Keep Video.js 8 with VHS, quality levels and its text-track renderer | Both players use it |
| Controls | Video.js's own control bar, rebuilt skin, plus new Video.js components for the missing controls | §4 |
| Feature set | The prototype's: next, one settings menu (quality, speed, captions, audio track, shortcuts), captions toggle, picture in picture, theatre, mini player, up next, start from beginning, live badge | Owner |
| Wide view | The prototype's theatre layout and behaviour | Owner |
| Progress bar | Production look kept: thickness, pill track, buffered layer and fill. Only the handle is redesigned | Owner |
| Volume | Redesigned | Owner |
| Settings menu | Prototype's contents and structure; visual design rebuilt from the production quality menu, using the YouTube and Vimeo panel pattern | Owner |
| Colour | From per-theme fanous-tokens. No colour is written in component CSS | Owner ("no theme colour" was a bug) |
| RTL | Playback controls and the progress bar stay left-to-right. Menus, labels and overlays follow the language | `player-themes.md` |
| Icons | Inline SVG. The Video.js icon font is not used | Fixes the "?" and tofu glyphs |

## 2. Comparison

**Prod** is the Video.js player on `main` today (owner's screenshot of its bar). **Prototype** is the
custom React layer on `proto/theme-demos` (`PlayerChrome.tsx`, `PlayerChromeView.tsx`). **Kept from**
says which side each proposed element comes from.

| Element | Prod | Prototype | Proposed | Kept from |
|---|---|---|---|---|
| Control bar backdrop | Flat pure-black band | Per-theme scrim or pane | Per-theme `bar` token: scrim, pane or band. Never flat black | Prototype |
| Layout | One row, progress squeezed between volume and time (540 of 1042px) | Full-width progress above one row of controls | Full-width progress above the row | Prototype |
| Control order | Play, volume, progress, time, captions, "Auto", "?", fullscreen | Play, next, volume, time · captions, settings, PiP, theatre, fullscreen | Prototype's order | Prototype |
| Progress track and fill | 12px pill, 16px on hover, translucent track, buffered layer, solid fill | 4px rail, 6px on hover | **Prod's geometry and layering.** Colours from theme tokens | Prod (owner) |
| Scrub handle | White 16px disc, left half clipped at 0:00 | 14px themed disc | **Redesigned:** 18px themed disc, 22px on hover and while dragging, fully visible at 0% and 100% in every browser | Redesign (owner) |
| Hover time tooltip | Video.js tooltip, unstyled font | Themed chip | Themed chip with tabular numerals, chapter title when the video has chapters, preview image when the video has preview sprites | Prototype, extended |
| Chapters | Markers inside the progress holder | 2px dark marks | Prod's markers, drawn as 2px gaps in the theme's bar colour | Prod |
| Volume | White bar with a grey shadow segment, handle only on hover | 76px native range, white track in Firefox | **Redesigned:** Video.js volume slider, always reserves 72px, 4px themed track, accent fill, 12px handle always shown, 6px track on hover. Hidden on players under 480px wide (phones have hardware volume), mute stays | Redesign (owner) |
| Time | Remaining only, "-58:12", monospace font | "0:00 / 2:26" in the UI font | "0:00 / 2:26", UI font, tabular numerals, total dimmed | Prototype |
| Quality | Bare "Auto" text button with its own popup | Row in the settings menu | Row in the settings menu. **Behaviour is prod's:** Auto plus each height, highest first, "Auto (720p)" shows the playing rendition, hidden when the stream has no renditions (Safari native HLS) | Prod behaviour, prototype placement (owner) |
| Settings menu | None (quality popup only) | Root list and submenus, visually weak | **Prototype's structure** (quality, speed, captions, audio track, shortcuts). **Visual rebuilt from prod's quality menu:** solid themed surface, hairline edge, selected row filled with a check mark. Panel above the gear, end-aligned, submenus slide in with a back row, 44px rows, never clipped | Prototype structure, prod visual, redesign (owner) |
| Speed | Not in the bar (keyboard only) | Settings submenu | Settings submenu, 0.25× to 2×, "Normal" for 1× | Prototype (owner) |
| Captions | Video.js captions menu button | Toggle in the bar and submenu in settings | Toggle in the bar (accent underline when on) and submenu in settings with "Caption style" | Prototype, plus Video.js caption settings |
| Audio track | None | Submenu when the video has more than one | Same | Prototype (owner) |
| Keyboard help | "?" glyph in the bar (renders as a box or "?") | Row in settings | Row in settings. `?` still opens it | Prototype (owner) |
| Next | None | Button after play | Same, when a next video is known | Prototype (owner) |
| Picture in picture | Disabled | Button | Video.js toggle, shown only where the API exists | Prototype (owner) |
| Theatre | None | Button, player goes full content width, related videos move below | Same layout and behaviour, remembered per viewer | Prototype (owner) |
| Mini player | None | Floats in the corner while playing and scrolled away | Same, with close and "back to video" | Prototype (owner) |
| Fullscreen | Video.js toggle | Button | Video.js toggle with SVG icons | Both |
| Big play | Bare white glyph, oval on desktop | Themed 76px disc, faint in the real player | Themed 76px disc, specificity fixed so the theme wins over Video.js | Prototype, fixed |
| Loading | Video.js spinner plus a second React overlay | Three themed bars | One themed spinner | Prototype |
| Start from beginning | Pill (PR #470) | Themed pill | PR #470's behaviour and `data-testid="player-start-over"`, themed pill | PR #470, prototype look |
| Live | No designed treatment | Live badge, "behind" time, go to live | Same, on Video.js's live tracker | Prototype |
| Error | Default dialog style | Themed panel with retry, fallback, report | Themed panel on prod's error handling (retry, fallback, details in development) | Prod logic, prototype look |
| Ended and up next | Nothing | Up-next card with play now and watch again | Same | Prototype |
| Captions styling | Video.js default | Themed cue background | Themed cue background and text, viewer's caption settings still win | Prototype |
| Hover on controls | Scale 1.05, no fill | Square outlined boxes in Firefox | 38px fill in the theme's hover shape behind the icon only; nothing else moves or changes | Redesign |
| Focus | 3px amber ring with black halo | Mixed | 2px accent ring on `:focus-visible` only | Design doc |
| Frame | Square wrapper painted behind rounded corners | Uneven frame, thicker on top; video not clipped at corners | No frame. One element owns radius and clip; whole-pixel height; nothing painted behind | Design doc |
| RTL | Control bar reversed, progress LTR, arrow keys swapped | Controls and progress LTR, menus RTL | Prototype's rule. Arrow keys follow the bar (Right is forward) in both languages | Prototype |

## 3. Root causes of the reported defects

The fixes in this spec target causes, not symptoms.

| Defect | Cause | Fix |
|---|---|---|
| Clipped white thumb at the start (prod) | `.vjs-progress-holder { contain: layout style paint }` clips everything outside the holder, so the half of the handle left of 0% is cut off | No paint containment or overflow clip on the progress holder or its ancestors up to the bar; the progress control has inline padding of at least half the hover handle |
| "?" glyph (prod) | The keyboard help button has no icon and relies on text; other controls use the Video.js icon font, which renders tofu if the font is blocked or late | Inline SVG icons for every control; help moves into settings |
| White volume bar with grey shadow (prod) | Our gradient and box-shadows layered over Video.js's own volume level and its icon-font handle | Rebuilt slider styles that reset Video.js's volume pseudo-elements |
| Remaining time in a different font (prod) | Time display set to a monospace stack | UI font with `font-variant-numeric: tabular-nums` |
| Flat black bar (prod) | Video.js default bar background where our transparent rule lost | Bar backdrop from the theme token, set at a specificity above Video.js |
| Boxy outlined hover squares (prototype, Firefox) | `:-moz-focusring` and a `border-radius` on the button itself, plus a single-class hover losing to `.video-js button` | Hover fill on a pseudo-element sized to the icon; Firefox focus pseudo-classes cleared; selectors at Video.js's specificity plus one |
| Frame thicker on top (prototype) | Fractional 16:9 height antialiases the top and bottom edges differently, and an outer ring is clipped by ancestors along three edges | No frame; height rounded to a whole pixel |
| Video not following the radius (prototype) | Radius on one element, `overflow: hidden` on another | One clip owner: `[data-vjs-player]` holds the radius and the clip; the `<video>`, poster and overlays are inside it |
| Square behind rounded corners (both) | `dark:bg-gray-900` on the wrapper directly behind the player | Wrapper background removed |
| Faint centre play (prototype) | `.video-js button { background: none }` beat the single-class rule | Selector at Video.js's specificity plus one |
| White volume track (prototype, Firefox) | `::-moz-range-*` pseudo-elements not styled | The slider is the Video.js div slider, which renders the same everywhere |

## 4. Architecture

### Options

**Restyle and extend Video.js components (recommended).** Video.js keeps building the control bar. Its
components are restyled from a clean skin, and the missing controls are added as Video.js components
(next, captions toggle, settings, theatre, live badge). The settings panel is a React component rendered
into its Video.js slot with a portal.

**Own React control layer.** Video.js runs with its control bar off and React draws every control, as
the prototype does.

| | Video.js components (recommended) | React layer |
|---|---|---|
| Accessibility | Sliders, buttons, time displays and fullscreen come with tested roles, names, `aria-valuetext` and keyboard handling, already translated by the Arabic language pack | Every role, name, value text and key binding is ours to write and keep correct |
| Captions | Text-track display, caption settings dialog and track switching stay Video.js's | Same renderer, but the switching UI is ours |
| Live | Live tracker and its seekable window drive the badge and go-to-live | Same API, but every state is ours to handle |
| Existing code | `keyboard-shortcuts.ts`, `accessibility.ts`, `volume-control.ts`, chapter markers, touch feedback and their tests keep working, because they find Video.js elements | Each of these would be rewritten or removed |
| Owner's choices | Prod's progress bar and quality behaviour are Video.js components already | Both would be rebuilt to look and act the same |
| Visual control | Full, once the skin replaces our old overrides and outranks Video.js's stylesheet | Full |
| Maintenance | Video.js upgrades can change markup; a skin test (§9) catches it | No Video.js markup dependency, more code of our own |
| Cost | Smaller: a skin, five small components, one panel | Larger: every control and state |

The prototype's visual bugs came from CSS losing to Video.js's stylesheet, not from Video.js's
components. A skin that outranks it removes the problem and keeps the accessibility and live behaviour
the React layer would have to rebuild. The settings panel is the one place where React earns its place,
because it has nested views and roving focus.

### Component tree

```text
[data-vjs-player]                    owns radius and clip, whole-pixel height
  video.vjs-tech, poster, text track display (captions)
  BigPlayButton                      themed disc
  LoadingSpinner                     themed
  ControlBar
    ProgressControl                  full width, first row
      SeekBar > LoadProgressBar, PlayProgressBar (handle), MouseTimeDisplay (tooltip), chapter markers
    PlayToggle · NextButton* · VolumePanel (MuteToggle, VolumeControl)
    CurrentTimeDisplay / DurationDisplay | LiveBadge*
    spacer
    CaptionsToggle* · SettingsButton* (React panel) · PictureInPictureToggle · TheatreToggle* · FullscreenToggle
React overlays: StartOver (PR #470) · UpNext / Replay · ErrorPanel · MiniPlayer close and return
* new Video.js components in apps/web/src/lib/video/components/
```

The skin is one stylesheet, `apps/web/src/styles/player-skin.css`, scoped to `.video-js.vjs-fanous`.
The chrome sections of `video-player.css` that it replaces are deleted, so there is one source of truth.

## 5. Behaviour

### Layout and sizes

| Part | Value |
|---|---|
| Control row | 48px, buttons in a 44px hit area with a 22px icon (1.9 stroke) and a 38px hover fill |
| Progress hit area | 20px tall (44px on coarse pointers), track 12px, 16px on hover (prod) |
| Handle | 18px, 22px on hover and while dragging, centred on the fill edge |
| Volume slider | 72px reserved, 4px track, 6px on hover, 12px handle |
| Settings panel | `min(280px, 100% - 16px)` wide, 44px rows, 12px radius, 8px above the bar, end-aligned with the gear |
| Big play | 76px disc, 32px icon, 60px on players under 480px wide |
| Breakpoints | Container queries on the player: under 480px the volume slider, PiP and theatre hide; under 360px next hides |

### States

| State | Shows |
|---|---|
| Not started | Poster, big play, bar |
| Playing, active | Bar fades in; hides after 4s of inactivity, never while a menu is open or the pointer is on the bar |
| Buffering | Spinner; big play hidden |
| Paused | Bar stays |
| Ended | Up-next card (next video thumbnail, title, channel, Play now, Watch again) or Watch again alone; bar hidden |
| Error | Themed panel: title, description, Retry when retryable, "Try another format" when a fallback exists, Report |
| Resumed at a saved time | Start from beginning pill at the top start corner (PR #470 rules: hides once it stops being relevant) |
| Live at edge | Red live badge with a pulsing dot; progress bar is the seekable window |
| Live behind | Badge turns neutral and reads "Live · 0:42 behind"; clicking it seeks to the edge |

### Surfaces

| Surface | Differences |
|---|---|
| Watch page (VOD) | Full feature set |
| Live | No duration; live badge in place of time; speed menu hidden |
| Shorts (portrait video) | Frame follows the video's 9:16 aspect up to 80vh; theatre hidden; bar compact |
| Embed | Same skin; no theatre, no mini player; next only inside a playlist embed |
| Theatre | Watch layout stacks: player at full content width with no radius, details and related videos below. Remembered in `localStorage` (`aun.player.theatre`), read safely |
| Fullscreen | Theatre and mini player off; bar padding grows by the safe-area insets |
| Picture in picture | Bar shows the PiP button pressed |
| Mini player | Watch page, players 640px and wider, while playing and the frame is less than 15% visible: the frame floats 360px wide at the bottom end corner with close (pauses) and "back to video" (scrolls back) |

### Settings menu

Root rows: Quality, Speed, Captions, Audio track (only with more than one), Keyboard shortcuts. Each row
shows its label at the start and its current value and a chevron at the end. Choosing a row slides its
submenu in from the end side (mirrored in RTL), with a back row at the top. Submenu rows reserve a check
column at the start; the selected row has the check and the theme's selected fill (the production quality
menu's treatment). Choosing an option applies it and returns to the root. The panel's height animates to
its content and scrolls inside `max-height: calc(100% - bar height - 16px)` so it is never clipped. Reduced
motion turns the slide into an instant swap.

Keyboard: the gear has `aria-haspopup="menu"` and `aria-expanded`. Opening focuses the first row. Up and
Down move with wrap, Home and End jump, Enter, Space and the end-side arrow open a submenu, the start-side
arrow and Backspace go back, Escape goes back and then closes, Tab closes. Closing returns focus to the
gear. Keys inside the panel never reach the player's shortcuts.

### Keyboard shortcuts

Kept from `keyboard-shortcuts.ts`: Space and K play or pause, J and Left back 10s, L and Right forward
10s, Up and Down volume, M mute, F fullscreen, P picture in picture, comma and period speed, 0 to 9 seek
to tenths, `?` help. Added: C captions, T theatre, N next. Changed: the arrow keys no longer swap in
Arabic, because the bar stays left-to-right.

### RTL

`dir="ltr"` on the control bar and progress bar; time reads "0:00 / 2:26" in Western numerals as the time
displays do today. Menus, the up-next card, the error panel, the start-over pill and every label are
`dir` of the page. Icons that point (chevrons, back) mirror in RTL menus; media icons do not.

## 6. Theming contract

Tokens are `--fanous-player-*` custom properties generated by fanous-tokens. Values per theme are in
`packages/fanous-tokens/themes/<theme>/player.json`; the build emits the active theme
(`ACTIVE_THEME`, default `lantern`) only, as `THEMES.md` requires. Component CSS uses only these tokens
and the shared scales. The values are the ones in `player-themes.md`.

| Token | Used for |
|---|---|
| `bar`, `bar-edge`, `bar-pad`, `bar-inset`, `bar-radius`, `blur` | Control bar backdrop, its edge, padding, inset from the frame, radius and backdrop filter |
| `icon`, `dim` | Icons and time; secondary text (total time, menu values) |
| `track`, `buffered`, `played`, `glow` | Progress and volume track, buffered range, played fill, fill glow |
| `handle`, `handle-edge` | Scrub and volume handle and its ring |
| `hover`, `press`, `shape` | Control hover fill, pressed fill, hover fill radius |
| `tip-bg`, `tip-text` | Hover time tooltip |
| `menu`, `menu-edge`, `menu-hover`, `menu-selected` | Settings panel surface, its edge, row hover, selected row |
| `accent` | Selected check, toggle underline, focus ring, volume fill |
| `big`, `big-icon`, `big-edge` | Big play |
| `spin` | Loading spinner |
| `pill`, `pill-edge` | Start from beginning and other on-video pills |
| `cue` | Caption background (text uses `icon`) |
| `err` | Error panel background |
| `live`, `live-text` | Live badge at the edge |

`menu-selected` and `live` are new; every other token is named after its `player-themes.md` entry. The
chrome sits over video, so a theme has one value per token for both page modes.

Validation (`pnpm check:tokens`): every theme defines every token and nothing else, and every value is
a single CSS value (no `;`, `{` or `}`). Most player surfaces are gradients over moving video, so contrast
is measured on the rendered player over a white and a black frame (§9), not computed from the tokens.

## 7. Browser matrix

| Browser | Version | How it is tested |
|---|---|---|
| Chrome, Edge | Latest two | Playwright Chromium |
| Firefox | Latest two and ESR | Playwright Firefox; real Firefox at device scale 2 before each player release |
| Safari macOS | 17 and later | Playwright WebKit |
| Safari iOS | 17 and later | Playwright WebKit with the iPhone profile; native fullscreen |
| Chrome Android | Latest | Playwright Chromium with the Pixel profile |

Firefox has no picture-in-picture API (it has its own overlay toggle), so the PiP button is hidden there.
Safari plays HLS natively, so Quality is absent there unless VHS is forced.

## 8. Accessibility

- Every control has a localized accessible name; toggles use `aria-pressed`; menus use `menu`,
  `menuitem` and `menuitemradio` with `aria-checked`.
- The seek slider has `aria-valuetext` "1:02 of 2:26"; the volume slider "40%".
- Focus is visible on every control (2px accent ring, at least 3:1 against the bar).
- Icons and text reach 4.5:1 against the bar over both a white and a black frame; the scrim carries
  that, not a text shadow.
- Touch targets are at least 44 by 44px; the progress bar's hit area is 44px tall on coarse pointers.
- Reduced motion removes the slide, scale and pulse animations.
- State changes the viewer did not cause (buffering, live edge) are announced by the existing live region.

## 9. Test plan

**Unit (Jest).** Settings model (rows shown, values, submenu navigation, keyboard focus movement),
quality list (order, Auto label, hidden without renditions), speed labels, time formatting, live
latency, theatre preference storage with a throwing `localStorage`, token generation and validation.

**E2E (Playwright, Chromium, Firefox and WebKit).** A development-only harness page mounts the
production player with local HLS fixtures (two renditions, a bright and a dark segment, English and
Arabic captions, chapters). It returns 404 in production builds. Specs:

- Play and pause, seek by click and by keyboard, volume and mute, settings (quality, speed, captions,
  audio), captions toggle, fullscreen, theatre, start over, keyboard shortcuts, RTL (control order, seek
  direction, menu direction).
- Computed-style and pixel checks: hover changes only the hovered control; no square background behind
  rounded corners; the frame is even on every edge; the video is clipped to the inner radius; every icon
  renders as SVG with a non-empty box and no text glyph; the handle is fully visible at 0% and 100%;
  the settings panel stays inside the player at 360px wide; icon contrast over the bright and dark
  segments.

**Manual.** Real Firefox at device scale 2, Safari, and each of the four themes on the theme demo sites.
