# Player audit

Audited on the video.js player at 1440px and 390px, in English and Arabic, measured from the live page.

| Element | Today | Problem |
|---|---|---|
| Big play | 95x51 oval on desktop, 84x84 on phone | Two different shapes, stretched on desktop and covering a quarter of the frame on phone |
| Play and pause | 36px, 32px on phone | Under the 44px touch target |
| Volume | 132px panel, 108px on phone | On phone it leaves the progress bar 82px of a 358px player. Phones have hardware volume. |
| Progress | Inline with the controls, 540 of 1042px | Short, so seeking is imprecise. Should span the full width above the controls. |
| Scrub handle | White bar on a pale track | Low visibility over bright video |
| Time | Remaining only | No elapsed time. A negative number with no total. |
| Quality | Bare text "Auto" in the bar | Reads as a label. Speed, subtitles and audio have no shared menu. |
| Quality menu | Floating card with a full-bleed filled row | Not grouped with other settings, and the heading is all caps |
| Keyboard help | "?" permanently in the bar | Rarely needed, should live in settings |
| Next, theatre, PiP | Absent | No next, theatre or picture-in-picture |
| RTL | Only the timer moves, to the far left | Controls keep LTR order, so it is neither mirrored nor consistently fixed |
| Control scrim | Light band behind controls on bright video | Controls lose contrast over bright frames |
| Error, end screen, up next | Default dialog, no end screen | No designed states |
| Live, shorts | No designed treatment | |

## Decision on RTL

Playback controls and the progress bar stay left-to-right in Arabic, because time runs that way on
YouTube, Apple and Netflix players. Grouping and menu text follow the language: menus and labels are
RTL, and elapsed and total time read together.
