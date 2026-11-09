/**
 * Keep the progress bar on the playhead after a seek (docs/specs/VIDEO-PLAYER.md section 7).
 *
 * Video.js redraws its seek bar on `timeupdate`, throttled to once per 30ms with no trailing call.
 * A seek made while paused fires a single `timeupdate`; when it lands within 30ms of the previous
 * one (a pause and a seek together, as resume, chapter jumps and the seek keys do), it is dropped
 * and a paused player fires no more, so the time read 0:20 while the bar stayed where the pause
 * left it. After each seek the bar is redrawn once more, outside that window.
 */
export const SEEK_BAR_THROTTLE_MS = 30;

interface SeekBarLike {
  update(): void;
}

interface ComponentLike {
  getChild(name: string): ComponentLike | undefined;
}

interface SyncPlayerLike extends ComponentLike {
  on(type: string, fn: () => void): void;
  off(type: string, fn: () => void): void;
  setTimeout(fn: () => void, ms: number): number;
  clearTimeout(id: number): void;
}

export function keepSeekBarOnPlayhead(player: SyncPlayerLike): () => void {
  let pending: number | null = null;
  const redraw = () => {
    if (pending !== null) player.clearTimeout(pending);
    pending = player.setTimeout(() => {
      pending = null;
      const seekBar = player.getChild('ControlBar')?.getChild('ProgressControl')?.getChild('SeekBar') as unknown as SeekBarLike | undefined;
      seekBar?.update();
    }, SEEK_BAR_THROTTLE_MS + 10);
  };
  player.on('seeked', redraw);
  return () => {
    player.off('seeked', redraw);
    if (pending !== null) player.clearTimeout(pending);
  };
}
