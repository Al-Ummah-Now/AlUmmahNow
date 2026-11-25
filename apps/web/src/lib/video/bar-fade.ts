/**
 * The control bar takes a tap for as long as it can be seen (#2024).
 *
 * Video.js fades the bar out over a second, but the bar stopped taking taps the moment the fade
 * began: a finger already on its way to a button that was showing reached nothing, and the tap only
 * brought the bar back ("the pause tap sometimes does nothing"). For the first half of the fade the
 * bar still takes it (player-skin.css, `vjs-fanous-bar-fading`); after that it is all but gone
 * (opacity 0.2 and falling), and a tap only shows it, as before.
 *
 * A finger put down on the bar is activity at once: Video.js counts it when it lifts, so a bar could
 * start to go under a finger. (The progress bar has its own: touch-seek-gate.ts.)
 */
export const BAR_FADING_CLASS = 'vjs-fanous-bar-fading';
/** Half of Video.js's 1 s fade */
export const BAR_FADE_GRACE_MS = 500;

interface FadePlayerLike {
  el(): Element | null;
  getChild(name: string): { el(): Element | null } | undefined;
  on(type: string, fn: () => void): void;
  off(type: string, fn: () => void): void;
  userActive(active: boolean): unknown;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export function keepBarTappableWhileItFades(player: FadePlayerLike): () => void {
  let pending: number | null = null;
  const end = () => {
    if (pending !== null) player.clearTimeout(pending);
    pending = null;
    player.el()?.classList.remove(BAR_FADING_CLASS);
  };
  const start = () => {
    end();
    player.el()?.classList.add(BAR_FADING_CLASS);
    pending = player.setTimeout(end, BAR_FADE_GRACE_MS);
  };
  const bar = player.getChild('ControlBar')?.el() ?? null;
  const onTouch = () => { player.userActive(true); };
  player.on('userinactive', start);
  player.on('useractive', end);
  bar?.addEventListener('touchstart', onTouch, { passive: true });
  return () => {
    player.off('userinactive', start);
    player.off('useractive', end);
    bar?.removeEventListener('touchstart', onTouch);
    end();
  };
}
