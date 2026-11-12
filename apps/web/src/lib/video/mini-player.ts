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
