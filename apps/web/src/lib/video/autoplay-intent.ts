/**
 * Autoplay intent for in-app advances (docs/specs/PLAYLIST-PLAYBACK.md section 4.1).
 *
 * "Play now", the countdown, the player's Next button and `N` navigate client-side and ask the
 * next watch page to start playing. The request travels in memory, not in the URL (D3), so a
 * shared or reloaded plain video link never autoplays. A list in the URL is intent by itself.
 *
 * `auto` marks an advance the viewer did not ask for (the countdown ran out): that view is
 * counted as autoplayed in creator analytics.
 */

let pending: { videoId: string; auto: boolean } | null = null;

/** The next watch page for `videoId` starts playing on its own. */
export function requestAutoplay(videoId: string, opts: { auto?: boolean } = {}): void {
  pending = { videoId, auto: opts.auto === true };
}

/** Whether an in-app advance asked `videoId` to play (read without consuming; idempotent per render). */
export function hasAutoplayIntent(videoId: string): boolean {
  return pending?.videoId === videoId;
}

/** Whether `videoId` was started by the countdown rather than by the viewer. */
export function isAutoAdvance(videoId: string): boolean {
  return pending?.videoId === videoId && pending.auto;
}

/** Called once the requested video is mounted, so a later plain visit does not autoplay. */
export function clearAutoplayIntent(videoId: string): void {
  if (pending?.videoId === videoId) pending = null;
}
