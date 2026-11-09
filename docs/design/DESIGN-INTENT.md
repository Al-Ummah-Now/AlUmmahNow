# Design intent

Each theme is a material, not a palette. Components use shared structure and take depth from
`apps/web/src/theme/materials/<theme>.css` (prototype location).

## Materials

| Theme | Material | Surfaces | Borders | Primary | Active item |
|---|---|---|---|---|---|
| Lantern | Warm light falling off into night teal | Vertical fall-off with a glow at the top | Gold-tinted hairline fading downward | Gold with a sheen | Light spreading from a small lit arch |
| Zujaj | Painted glass | Translucent, blurred panes | Light on the edge: inner hairline and top highlight | Teal glass with a gloss | A frosted pane and a gold glass rod |
| Nahas | Worked brass | Banded metal gradients | Embossed top, engraved lower edge, shelf shadow | Metallic bands with a break line | An embossed plate and a small dome |
| Fawanees | Gold lantern light at night | Pools of warm light | Gilded gradient hairline | Rich gold with a halo | Radial light and a hanging lantern |

## Structure

- **Navigation.** Items first, grouped under You, Create and More. A 76px rail expands to 264px. Phones get a drawer and a bottom bar. Theme and language are small icon controls at the foot.
- **Header.** Brand at the start, search in the centre, then upload, notifications and account, all 44px tall.
- **Gradients have jobs:** a page atmosphere, surface fall-off, active states, heroes, primary actions, gilded or embossed borders, and scrims over media.
- **One accent per view.** Secondary actions use the material, not the accent. On the watch page Share and Save are secondary.
- **Cards.** Video cards are the thumbnail, with no box. Boxes are for forms, settings and overlays.

## Pages

- **Home:** a featured hero, continue watching, then a responsive grid.
- **Watch:** the player leads, then title, channel and secondary actions, comments below, up next at the side.
- **Channel:** a hero with identity, and sticky themed tabs.
- **Upload:** a dropzone in the theme's material, with guidelines beneath.
- **Settings and profile:** materials on rows and cards, a hero on the profile.
- **Search and history:** a clear heading and designed empty states.
- **Sign-in:** the themed graphic above the form.

## Player

Controls are a single layer over the existing engine: full-width progress with buffered, chapters, a time
tooltip and a handle; play, next, volume and time at the start; captions, settings, picture in picture,
theatre and full screen at the end. One settings menu holds quality, speed, captions and shortcuts.
Designed states: start, buffering, up next, live, mini player and error. Touch targets are 44px. Playback
controls stay left-to-right in Arabic, and menus follow the language.

## Selected navigation item

YouTube and Kick (seen first-hand) mark the current item with a quiet rounded surface, and YouTube also
fills the icon and strengthens the label. Linear, Arc, Twitch and Apple TV are second-hand references.

Selected means: a filled icon, a heavier label, a quiet surface in the theme's material, and one 3px bar
on the start side, which moves to the right in Arabic. The same treatment applies in the rail, the
expanded drawer and the phone drawer. Hover is a neutral tint with no bar or filled icon. Focus-visible
is a ring. No decorative shapes or glows beyond a faint halo on Lantern's and Fawanees's bar.
