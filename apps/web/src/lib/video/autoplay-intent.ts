/**
 * Autoplay intent for in-app advances (docs/specs/PLAYLIST-PLAYBACK.md section 4.1).
 *
 * "Play now", the countdown, the player's Next button and `N` navigate client-side and ask the
 * next watch page to start playing. The request travels in memory, not in the URL (D3), so a
 * shared or reloaded plain video link never autoplays. A list in the URL is intent by itself.
 *
 * When the client-side move does not commit, navigateOrLoad loads the page instead and memory is
 * gone: the countdown ran out and the next video sat paused (Player E2E Firefox, #1137). The
 * request is therefore also kept in this tab's sessionStorage (never the URL) for a short while,
 * and consumed when the requested video mounts, so a later reload or a shared link still does not
 * autoplay.
 *
 * `auto` marks an advance the viewer did not ask for (the countdown ran out): that view is
 * counted as autoplayed in creator analytics.
 */

interface Intent {
  videoId: string;
  auto: boolean;
  at: number;
}

const STORAGE_KEY = 'aun.player.autoplayIntent';
/** How long a request survives a page load: the fallback loads within seconds */
export const AUTOPLAY_INTENT_TTL_MS = 60_000;

let pending: Intent | null = null;

function session(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

function stored(now = Date.now()): Intent | null {
  try {
    const raw = session()?.getItem(STORAGE_KEY);
    if (!raw) return null;
    const intent = JSON.parse(raw) as Partial<Intent>;
    if (typeof intent.videoId !== 'string' || typeof intent.at !== 'number' || now - intent.at > AUTOPLAY_INTENT_TTL_MS) return null;
    return { videoId: intent.videoId, auto: intent.auto === true, at: intent.at };
  } catch {
    return null;
  }
}

function current(): Intent | null {
  return pending ?? stored();
}

/** The next watch page for `videoId` starts playing on its own. */
export function requestAutoplay(videoId: string, opts: { auto?: boolean } = {}): void {
  pending = { videoId, auto: opts.auto === true, at: Date.now() };
  try {
    session()?.setItem(STORAGE_KEY, JSON.stringify(pending));
  } catch {
    // storage blocked: the in-memory request still covers a client-side move
  }
}

/** Whether an in-app advance asked `videoId` to play (read without consuming; idempotent per render). */
export function hasAutoplayIntent(videoId: string): boolean {
  return current()?.videoId === videoId;
}

/** Whether `videoId` was started by the countdown rather than by the viewer. */
export function isAutoAdvance(videoId: string): boolean {
  const intent = current();
  return intent?.videoId === videoId && intent.auto;
}

/** Called once the requested video is mounted, so a later plain visit does not autoplay. */
export function clearAutoplayIntent(videoId: string): void {
  if (pending?.videoId === videoId) pending = null;
  if (stored()?.videoId === videoId) {
    try {
      session()?.removeItem(STORAGE_KEY);
    } catch {
      // nothing stored
    }
  }
}
