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
 *    player's `loadstart`, or `loadedmetadata` where that has passed, and then for a timer: Video.js
 *    clears its "changing source" flag in a 1 ms timer it sets just before the player's own ready
 *    callbacks, so one set after them runs later.
 * 2. A play() can still be aborted by a real source change (the delivery fallback). The next try
 *    cannot wait for `canplay`: WebKit with Media Source decodes nothing while paused, so the
 *    element stays at HAVE_METADATA and `canplay` never comes. `loadedmetadata` always does.
 * 3. A pause() aborts a pending play() too, with the same AbortError. Whoever paused (the viewer or
 *    the host page) is never overridden. A source change sends no `pause` event and leaves the
 *    element without metadata; a pause sends one.
 */

/** The part of a Video.js player these helpers need. */
export interface StartablePlayer {
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
  one(event: string, fn: () => void): void;
  paused(): boolean;
  readyState?(): number;
  isDisposed?(): boolean;
}

const HAVE_METADATA = 1;
/** Video.js's own delay for the timer that clears its flag; equal timers run in the order they were set */
const SOURCE_FLAG_TIMER_MS = 1;

/** One start of a player: alive until it played, was paused, or was cancelled. */
export interface PlaybackStart {
  /** Nothing more starts (the host paused before there was anything to pause) */
  cancel(): void;
  cancelled(): boolean;
  /** Runs `fn` once, once the source is attached and Video.js counts it as ready */
  whenSourceAttached(fn: () => void): void;
  /** After an aborted play(): runs `fn` at the new source's `loadedmetadata`; never after a pause */
  afterReload(fn: () => void): void;
}

export function beginStart(player: StartablePlayer): PlaybackStart {
  let over = false;
  const cancel = () => {
    over = true;
    player.off('pause', onPause);
  };
  // WebKit sends a late `pause` after refusing sound, when the muted play is already on: not a pause
  function onPause() {
    if (player.paused()) cancel();
  }
  player.on('pause', onPause);
  player.one('playing', () => player.off('pause', onPause));
  const run = (fn: () => void) => () => {
    if (!over && !player.isDisposed?.()) fn();
  };
  const hasMetadata = () => (player.readyState?.() ?? 0) >= HAVE_METADATA;
  return {
    cancel,
    cancelled: () => over,
    whenSourceAttached(fn) {
      let done = false;
      const once = () => {
        if (done) return;
        done = true;
        setTimeout(run(fn), SOURCE_FLAG_TIMER_MS);
      };
      if (hasMetadata()) return once();
      player.one('loadstart', once);
      player.one('loadedmetadata', once);
    },
    afterReload(fn) {
      // Still has its metadata: nothing was reloaded, so it was paused
      if (!over && !hasMetadata()) player.one('loadedmetadata', run(fn));
    },
  };
}
