/**
 * Starting playback while the source is still being attached.
 *
 * Two facts every start has to live with:
 *
 * 1. A play() before Video.js counts its source as ready goes wrong. On a Safari user agent (Safari,
 *    and WebKitGTK/WPE) Video.js answers it with load(), which for VHS sets the source AGAIN
 *    (Player#play_, Player#load). The first play() then runs on the first attach and the second one
 *    aborts it (AbortError): a race the viewer lost about every other time (the embed sat on its big
 *    play button, releases of 2026-11-24 and 2026-11-25). Elsewhere Video.js queues it for the next
 *    `loadstart`, which never comes when the element's own was first. The media element's
 *    networkState does not tell: it is LOADING before Video.js is ready. So a start waits for the
 *    player's `loadstart`, or `loadedmetadata` where that has passed.
 * 2. A play() can still be aborted by a real source change (the delivery fallback). The next try
 *    cannot wait for `canplay`: WebKit with Media Source decodes nothing while paused, so the
 *    element stays at HAVE_METADATA and `canplay` never comes. `loadedmetadata` always does.
 */

/** The part of a Video.js player these helpers need. */
export interface StartablePlayer {
  one(event: string, fn: () => void): void;
  readyState?(): number;
  isDisposed?(): boolean;
}

const HAVE_METADATA = 1;

const whenAlive = (player: StartablePlayer, fn: () => void) => () => {
  if (!player.isDisposed?.()) fn();
};

/** Runs `fn` once, when the source is attached: now if it has metadata, else at `loadstart` or `loadedmetadata`. */
export function whenSourceAttached(player: StartablePlayer, fn: () => void): void {
  if ((player.readyState?.() ?? 0) >= HAVE_METADATA) return fn();
  let done = false;
  const run = whenAlive(player, () => {
    if (done) return;
    done = true;
    fn();
  });
  player.one('loadstart', run);
  player.one('loadedmetadata', run);
}

/**
 * Runs `fn` when a play() that was just aborted can be tried again. A source change left the element
 * without metadata: at its `loadedmetadata`. With metadata (it was paused, not reloaded): at the
 * next `canplay`.
 */
export function whenPlayableAgain(player: StartablePlayer, fn: () => void): void {
  const loaded = (player.readyState?.() ?? 0) >= HAVE_METADATA;
  player.one(loaded ? 'canplay' : 'loadedmetadata', whenAlive(player, fn));
}
