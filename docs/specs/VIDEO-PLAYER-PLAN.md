# Video player plan

**Spec:** [VIDEO-PLAYER.md](./VIDEO-PLAYER.md) · **Date:** 2026-11-09

Two PRs from `main`: this docs PR, then one build PR. Nothing merges until the owner approves.

## Build PR, in order

| Step | Work | Files |
|---|---|---|
| 1 | Player tokens: `themes/<theme>/player.json` for Lantern, Zujaj, Nahas and Fawanees with the `player-themes.md` values plus `menu-selected`, `live`, `live-text`; a generator writing `generated/player/<theme>.css`; validation in `check:tokens`; tests | `packages/fanous-tokens/` |
| 2 | Build-time selection: webpack alias `@fanous/player-tokens.css` resolves to the `ACTIVE_THEME` file (default `lantern`) | `apps/web/next.config.ts` |
| 3 | Icons: one SVG icon set and a helper that puts an icon into a Video.js component's placeholder | `apps/web/src/lib/video/icons.ts` |
| 4 | New Video.js components: next, captions toggle, settings slot, theatre, live badge; registration and control-bar order in `videojs-setup.ts`; the quality selector plugin's button removed while its quality logic moves into the settings model | `apps/web/src/lib/video/components/`, `videojs-setup.ts` |
| 5 | Settings: a pure model (rows, values, navigation) with unit tests, and the React panel rendered into the settings slot | `apps/web/src/lib/video/settings-model.ts`, `apps/web/src/components/VideoPlayer/SettingsMenu.tsx` |
| 6 | Skin: `player-skin.css` scoped to `.video-js.vjs-fanous`, token-only colours; delete the chrome sections of `video-player.css` it replaces; remove the wrapper background behind the frame; whole-pixel frame height | `apps/web/src/styles/` |
| 7 | Overlays: up next and replay, themed error panel on the existing error handling, start-over pill styling (PR #470's control), mini player | `apps/web/src/components/VideoPlayer/` |
| 8 | Theatre on the watch page, remembered per viewer; shorts aspect; embed differences | `WatchPageContent.tsx`, `EmbedPlayer.tsx` |
| 9 | Keyboard: C, T and N; arrow keys stop swapping in Arabic; help leaves the bar | `keyboard-shortcuts.ts` |
| 10 | Harness page (404 in production) and HLS fixtures; Playwright config for Chromium, Firefox and WebKit; specs from spec §9; a CI workflow running them on player changes | `apps/web/src/app/[locale]/dev/player/`, `apps/web/e2e/player/` |
| 11 | Verification: unit tests, type check, lint, the three-browser E2E run, real Firefox at device scale 2, and a trial merge into `proto/theme-demos` | |

PR #470 (start from beginning) is still open. The build branch merges it so the start-over control and
its tests exist; the build PR's diff shrinks to its own changes once #470 is on `main`.

## Theme demo branch

`proto/theme-demos` mounts its prototype layer (`PlayerChrome`) inside `CustomVideoPlayer`. A trial
merge of the build PR replaces that mount with the production controls and keeps the demo's other
changes. The resolved merge is pushed as its own branch for the demo owner to merge, so
`proto/theme-demos` itself is not edited. The demo build already sets `ACTIVE_THEME`, so each demo site
gets its theme's player tokens from step 2 with no extra step.

## Done when

- Every row of the spec's comparison table is implemented as stated.
- Unit tests and the three-browser E2E suite pass locally and in CI.
- Real Firefox at device scale 2 shows no hover boxes, an even frame, clipped corners, rendered icons and
  a fully visible handle.
- The four theme demo sites build from the resolved merge.
