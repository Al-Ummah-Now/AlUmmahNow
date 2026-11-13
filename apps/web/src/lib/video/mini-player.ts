/**
 * When the watch page floats the player as the mini player (docs/specs/VIDEO-PLAYER.md section 5).
 *
 * Visibility is the share of the frame below the sticky top bar. The switch has hysteresis: the
 * player floats once less than a quarter of it shows and only docks again once more than 60%
 * shows, so a page held near one edge never flips it back and forth. It never switches while a
 * finger is on the player (the controls would move under it), and pausing in the mini player
 * keeps it floating: only scrolling the frame back, or closing it, docks it.
 */
export const MINI_ENTER_BELOW = 0.25;
export const MINI_LEAVE_ABOVE = 0.6;
/** Narrower viewports (phones) never float the player */
export const MINI_MIN_VIEWPORT = 640;

export interface MiniInput {
  mini: boolean;
  /** Share of the frame visible below the top bar, 0 to 1 */
  ratio: number;
  playing: boolean;
  /** The viewer closed the mini player and has not seen the frame since */
  dismissed: boolean;
  viewportWidth: number;
  /** A finger is on the player */
  touching: boolean;
}

export function nextMini({ mini, ratio, playing, dismissed, viewportWidth, touching }: MiniInput): boolean {
  if (viewportWidth < MINI_MIN_VIEWPORT) return false;
  if (touching) return mini;
  if (mini) return ratio <= MINI_LEAVE_ABOVE;
  return ratio < MINI_ENTER_BELOW && playing && !dismissed;
}

/**
 * Phones (owner, 2026-11-13: "when I scroll, the player disappears"): where the mini player never
 * floats, the watch page keeps the player pinned to the top while the details, comments and
 * related videos scroll beneath it, the way YouTube's mobile site does. Portrait phones only:
 * in landscape the player fills the screen already, and fullscreen is left alone.
 */
export const PIN_MEDIA_QUERY = `(max-width: ${MINI_MIN_VIEWPORT - 1}px) and (orientation: portrait)`;

export interface PinInput {
  /** The frame's top edge, in viewport px */
  frameTop: number;
  /** The top bar's bottom edge (0 when the top bar scrolls away), in viewport px */
  inset: number;
  /** The viewport matches PIN_MEDIA_QUERY */
  phone: boolean;
  fullscreen: boolean;
}

/** Pinned once the frame's top reaches the top bar; unpinned as soon as it comes back down */
export function nextPinned({ frameTop, inset, phone, fullscreen }: PinInput): boolean {
  if (!phone || fullscreen) return false;
  return frameTop < inset;
}
