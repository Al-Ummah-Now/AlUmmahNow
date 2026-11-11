/**
 * Autoplay intent for in-app advances (docs/specs/PLAYLIST-PLAYBACK.md section 4.1).
 *
 * "Play now", the countdown, the player's Next button and `N` navigate client-side and ask the
 * next watch page to start playing. The request travels in memory, not in the URL (D3), so a
 * shared or reloaded plain video link never autoplays. A list in the URL is intent by itself.
 */

let pending: string | null = null;

/** The next watch page for `videoId` starts playing on its own. */
export function requestAutoplay(videoId: string): void {
  pending = videoId;
}

/** Whether an in-app advance asked `videoId` to play (read without consuming; idempotent per render). */
export function hasAutoplayIntent(videoId: string): boolean {
  return pending === videoId;
}

/** Called once the requested video is mounted, so a later plain visit does not autoplay. */
export function clearAutoplayIntent(videoId: string): void {
  if (pending === videoId) pending = null;
}
