# Player themes

Per-theme design for the production player (`docs/specs/VIDEO-PLAYER.md`). Values are what the theme demos
currently deploy, from `apps/web/src/theme/player-themes.css`.

## Rules for every theme

- **No frame.** No border, ring or outer shadow on the video. Ancestors on the watch page clip outside their box, so an outer ring only survives along the bottom edge.
- **One clip.** One element owns the radius and `overflow: hidden`. The poster, video, control bar and overlays are clipped by it. Radius is the theme's `lg` value.
- **Whole-pixel height.** A 16:9 box often has a fractional height, which antialiases the bottom edge differently from the top. Round the frame height to a whole pixel.
- **Nothing painted behind the frame.** The wrapper directly behind the player had `dark:bg-gray-900`, which showed as a square behind the rounded corners.
- **Hover** is a 38px fill behind a 22px icon inside a 44px hit area, sized to the icon. No border, ring or outline. Only the control reacts, and nothing moves.
- **Pressed** uses the pressed fill, scaled to 0.93. It must be declared after hover or hover wins.
- **Focus** is a 2px ring in the accent colour, on `:focus-visible` only.
- **Volume** always reserves its slider space. Expanding it on hover moved the neighbouring controls out from under the pointer.
- **Specificity.** Video.js ships `.video-js button { background: none }`, which beats a single-class rule. That is why the big play looked like a faint outline in the real player.
- **Firefox.** Style `::-moz-range-track`, `::-moz-range-progress` and `::-moz-range-thumb`, and clear `::-moz-focus-inner` and `:-moz-focusring`.
- **Modes.** The chrome sits over video, so each theme has one chrome for both page modes. Colours must stay readable over bright and dark frames.
- **RTL.** Playback controls and the progress bar stay left-to-right. Menus and labels follow the language.

## Character

| Theme | Control bar | Played bar | Big play |
|---|---|---|---|
| Lantern | Amber scrim, light falling off from the start side | Gold gradient with a glow | Glowing gold orb |
| Zujaj | Floating frosted pane, inset 10px, with a glass highlight | Teal to pale glass | Frosted glass disc |
| Nahas | Solid brass band with engraved edges, no scrim | Metallic copper in a dark engraved groove | Banded brass disc with a rim |
| Fawanees | Deep night with a pool of gold light | Rich gold with a strong glow | Gold orb with a wide halo |

## Token values

### Control bar background (`--p-bar`)

| Theme | Value |
|---|---|
| Lantern | `radial-gradient(70% 150% at 12% 100%,rgb(232 180 119/.26),transparent 70%),linear-gradient(0deg,rgb(26 15 5/.96),rgb(38 23 8/.86) 62%,rgb(38 23 8/.42) 82%,transparent)` |
| Zujaj | `linear-gradient(135deg,rgb(255 255 255/.16),transparent 42%),rgb(8 58 69/.78)` |
| Nahas | `linear-gradient(180deg,#6a3d1a,#3d210d 42%,#2a1508)` |
| Fawanees | `radial-gradient(45% 170% at 50% 118%,rgb(244 174 58/.32),transparent 72%),linear-gradient(0deg,rgb(5 12 20/.97),rgb(9 21 30/.88) 62%,rgb(9 21 30/.44) 82%,transparent)` |

### Control bar edge (`--p-bar-edge`)

| Theme | Value |
|---|---|
| Lantern | `none` |
| Zujaj | `inset 0 1px 0 rgb(255 255 255/.34),inset 0 0 0 1px rgb(255 255 255/.14),0 10px 26px rgb(3 30 36/.42)` |
| Nahas | `inset 0 1px 0 rgb(255 211 154/.5),inset 0 2px 0 rgb(0 0 0/.3),inset 0 -1px 0 rgb(0 0 0/.45)` |
| Fawanees | `none` |

### Control bar padding (`--p-bar-pad`)

| Theme | Value |
|---|---|
| Lantern | `44px 12px 6px` |
| Zujaj | `6px 10px 2px` |
| Nahas | `8px 12px 2px` |
| Fawanees | `44px 12px 6px` |

### Control bar inset from the frame (`--p-bar-inset`)

| Theme | Value |
|---|---|
| Lantern | `0` |
| Zujaj | `10px` |
| Nahas | `0` |
| Fawanees | `0` |

### Control bar radius (`--p-bar-radius`)

| Theme | Value |
|---|---|
| Lantern | `0` |
| Zujaj | `12px` |
| Nahas | `0` |
| Fawanees | `0` |

### Backdrop filter (`--p-blur`)

| Theme | Value |
|---|---|
| Lantern | `none` |
| Zujaj | `blur(16px) saturate(1.4)` |
| Nahas | `none` |
| Fawanees | `none` |

### Icons and time (`--p-icon`)

| Theme | Value |
|---|---|
| Lantern | `#fff1d9` |
| Zujaj | `#f0fdff` |
| Nahas | `#ffe6c4` |
| Fawanees | `#fff4d4` |

### Secondary text (`--p-dim`)

| Theme | Value |
|---|---|
| Lantern | `#f1d9b6` |
| Zujaj | `#d0eef2` |
| Nahas | `#f0cda0` |
| Fawanees | `#f3dea8` |

### Progress and volume track (`--p-track`)

| Theme | Value |
|---|---|
| Lantern | `rgb(255 232 196/.3)` |
| Zujaj | `rgb(230 250 252/.28)` |
| Nahas | `#1c0d04` |
| Fawanees | `rgb(255 232 170/.26)` |

### Buffered (`--p-buffered`)

| Theme | Value |
|---|---|
| Lantern | `rgb(255 232 196/.52)` |
| Zujaj | `rgb(230 250 252/.5)` |
| Nahas | `#744219` |
| Fawanees | `rgb(255 232 170/.48)` |

### Played fill (`--p-played`)

| Theme | Value |
|---|---|
| Lantern | `linear-gradient(90deg,#cf985d,#e8b477 60%,#f8e8be)` |
| Zujaj | `linear-gradient(90deg,#1696b0,#5cc4d4 55%,#c9eef1)` |
| Nahas | `linear-gradient(180deg,#ffe0b8,#ffa037 48%,#b86a17)` |
| Fawanees | `linear-gradient(90deg,#e0962a,#f4ae3a 50%,#fbc661)` |

### Played glow (`--p-glow`)

| Theme | Value |
|---|---|
| Lantern | `0 0 12px rgb(245 207 146/.75)` |
| Zujaj | `0 0 10px rgb(92 196 212/.8)` |
| Nahas | `none` |
| Fawanees | `0 0 14px rgb(244 174 58/.9)` |

### Scrub and volume handle (`--p-handle`)

| Theme | Value |
|---|---|
| Lantern | `radial-gradient(circle at 50% 35%,#f8e8be,#e8b477 70%)` |
| Zujaj | `linear-gradient(145deg,#fff,#c9eef1)` |
| Nahas | `radial-gradient(circle at 38% 30%,#ffe9c9,#ffa037 55%,#a55c12)` |
| Fawanees | `radial-gradient(circle at 50% 35%,#ffe6a8,#f4ae3a 72%)` |

### Handle edge (`--p-handle-edge`)

| Theme | Value |
|---|---|
| Lantern | `0 0 0 2px rgb(38 23 8/.9),0 0 12px rgb(245 207 146/.8)` |
| Zujaj | `0 0 0 1px rgb(8 58 69/.7),0 2px 6px rgb(3 30 36/.5)` |
| Nahas | `0 0 0 1px #2a1508,inset 0 -1px 1px rgb(0 0 0/.3)` |
| Fawanees | `0 0 0 2px #09151e,0 0 14px rgb(244 174 58/.9)` |

### Control hover fill (`--p-hover`)

| Theme | Value |
|---|---|
| Lantern | `rgb(245 207 146/.24)` |
| Zujaj | `rgb(226 248 251/.24)` |
| Nahas | `rgb(255 176 88/.26)` |
| Fawanees | `rgb(251 198 97/.24)` |

### Control pressed fill (`--p-press`)

| Theme | Value |
|---|---|
| Lantern | `rgb(245 207 146/.4)` |
| Zujaj | `rgb(226 248 251/.4)` |
| Nahas | `rgb(255 176 88/.42)` |
| Fawanees | `rgb(251 198 97/.42)` |

### Hover shape radius (`--p-shape`)

| Theme | Value |
|---|---|
| Lantern | `50%` |
| Zujaj | `11px` |
| Nahas | `50%` |
| Fawanees | `50%` |

### Time tooltip background (`--p-tip-bg`)

| Theme | Value |
|---|---|
| Lantern | `#e8b477` |
| Zujaj | `rgb(226 248 251/.96)` |
| Nahas | `linear-gradient(180deg,#ffd9a8,#ffa037)` |
| Fawanees | `#fbc661` |

### Time tooltip text (`--p-tip-c`)

| Theme | Value |
|---|---|
| Lantern | `#1c1205` |
| Zujaj | `#07303b` |
| Nahas | `#2a1508` |
| Fawanees | `#09151e` |

### Menu panel (`--p-menu`)

| Theme | Value |
|---|---|
| Lantern | `linear-gradient(180deg,rgb(46 29 11/.97),rgb(26 15 5/.97))` |
| Zujaj | `linear-gradient(135deg,rgb(255 255 255/.14),transparent 46%),rgb(8 58 69/.86)` |
| Nahas | `linear-gradient(170deg,#553014,#2a1508)` |
| Fawanees | `linear-gradient(180deg,#112a3b,#071119)` |

### Menu edge (`--p-menu-edge`)

| Theme | Value |
|---|---|
| Lantern | `0 18px 40px rgb(0 0 0/.5),0 0 40px -14px rgb(232 180 119/.5)` |
| Zujaj | `inset 0 1px 0 rgb(255 255 255/.3),inset 0 0 0 1px rgb(255 255 255/.14),0 18px 36px rgb(3 30 36/.5)` |
| Nahas | `inset 0 1px 0 rgb(255 211 154/.42),0 18px 36px rgb(26 10 2/.6)` |
| Fawanees | `0 18px 40px rgb(0 0 0/.55),0 0 46px -12px rgb(244 174 58/.6)` |

### Menu item hover (`--p-mi-hover`)

| Theme | Value |
|---|---|
| Lantern | `rgb(245 207 146/.18)` |
| Zujaj | `rgb(226 248 251/.18)` |
| Nahas | `rgb(255 176 88/.2)` |
| Fawanees | `rgb(251 198 97/.16)` |

### Accent: selected, focus ring, volume fill (`--p-accent`)

| Theme | Value |
|---|---|
| Lantern | `#f5cf92` |
| Zujaj | `#8fd8e0` |
| Nahas | `#ffb765` |
| Fawanees | `#fbc661` |

### Big play background (`--p-big`)

| Theme | Value |
|---|---|
| Lantern | `radial-gradient(circle at 50% 32%,#f8e8be,#e8b477 58%,#cf985d)` |
| Zujaj | `linear-gradient(145deg,rgb(255 255 255/.3),transparent 52%),rgb(8 58 69/.82)` |
| Nahas | `linear-gradient(180deg,#ffe0b8 0%,#ffb765 20%,#ffa037 50%,#e08a24 53%,#ffa037 100%)` |
| Fawanees | `radial-gradient(circle at 50% 30%,#ffe6a8,#f4ae3a 60%,#e0962a)` |

### Big play icon (`--p-big-c`)

| Theme | Value |
|---|---|
| Lantern | `#1c1205` |
| Zujaj | `#f0fdff` |
| Nahas | `#2a1508` |
| Fawanees | `#09151e` |

### Big play edge (`--p-big-edge`)

| Theme | Value |
|---|---|
| Lantern | `0 0 0 6px rgb(232 180 119/.26),0 0 34px rgb(245 207 146/.6),0 8px 22px rgb(26 15 5/.5)` |
| Zujaj | `inset 0 1px 0 rgb(255 255 255/.5),inset 0 0 0 1px rgb(255 255 255/.26),0 10px 26px rgb(3 30 36/.45)` |
| Nahas | `inset 0 1px 0 rgb(255 255 255/.6),inset 0 -2px 0 rgb(90 44 8/.5),0 0 0 3px #4a290f,0 0 0 4px rgb(255 211 154/.55),0 8px 22px rgb(26 10 2/.55)` |
| Fawanees | `0 0 0 7px rgb(244 174 58/.24),0 0 44px rgb(244 174 58/.72),0 8px 24px rgb(5 12 20/.55)` |

### Loading indicator (`--p-spin`)

| Theme | Value |
|---|---|
| Lantern | `#e8b477` |
| Zujaj | `#8fd8e0` |
| Nahas | `#ffa037` |
| Fawanees | `#fbc661` |

### Start from beginning background (`--p-pill`)

| Theme | Value |
|---|---|
| Lantern | `rgb(38 23 8/.9)` |
| Zujaj | `rgb(8 58 69/.84)` |
| Nahas | `linear-gradient(180deg,#5a3315,#2f180a)` |
| Fawanees | `rgb(9 21 30/.92)` |

### Start from beginning border (`--p-pill-edge`)

| Theme | Value |
|---|---|
| Lantern | `rgb(245 207 146/.55)` |
| Zujaj | `rgb(226 248 251/.4)` |
| Nahas | `rgb(255 211 154/.5)` |
| Fawanees | `rgb(251 198 97/.65)` |

### Caption background (`--p-cue`)

| Theme | Value |
|---|---|
| Lantern | `rgb(26 15 5/.82)` |
| Zujaj | `rgb(8 58 69/.82)` |
| Nahas | `rgb(42 21 8/.88)` |
| Fawanees | `rgb(5 12 20/.84)` |

### Error state background (`--p-err`)

| Theme | Value |
|---|---|
| Lantern | `radial-gradient(55% 75% at 50% 26%,#7a4f1f,#1c1205 78%)` |
| Zujaj | `linear-gradient(135deg,#0f5a6b,#062a33)` |
| Nahas | `linear-gradient(170deg,#6a3d1a,#20100a)` |
| Fawanees | `radial-gradient(50% 72% at 50% 26%,#4a3a14,#09151e 78%)` |

## Geometry

| Part | Value |
|---|---|
| Big play | 76px circle, 32px icon, scale 1.05 on hover, 0.96 pressed |
| Control button | 44px hit area, 22px icon, 1.9 stroke |
| Track | 4px, 6px on hover, inside a 20px hit area |
| Handle | 14px |
| Volume slider | 76px, 12px thumb |
| Menu | 260px wide, 44px rows |
