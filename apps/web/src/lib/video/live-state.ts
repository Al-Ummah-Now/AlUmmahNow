/**
 * Whether a player is showing a live stream (docs/specs/VIDEO-PLAYER.md section 5, Surfaces).
 *
 * Video.js's live tracker only runs once the stream's seekable window passes its threshold (20s), so
 * a live stream with a shorter window, or none, reads as not live there. Video.js still marks such a
 * player live by its unbounded duration, and so does this.
 */
export interface LivePlayerLike {
  liveTracker?: { isLive(): boolean };
  duration(): number;
}

export function isLivePlayback(player: LivePlayerLike): boolean {
  return !!player.liveTracker?.isLive() || player.duration() === Infinity;
}

/** Whether the live tracker is running, so the distance behind the live edge is known */
export function isTrackingLive(player: Pick<LivePlayerLike, 'liveTracker'>): boolean {
  return !!player.liveTracker?.isLive();
}

interface TechLike {
  on(type: string, fn: () => void): void;
  off(type: string, fn: () => void): void;
  trigger(type: string): void;
}

interface DurationPlayerLike {
  tech(opts: { IWillNotUseThisInPlugins: true }): TechLike | undefined;
}

/**
 * Keep the player's duration in step with a stream's playlist, before the media has loaded.
 *
 * Video.js reads the duration again on the media's `durationchange`. HLS (VHS) reports a live
 * stream's duration as unbounded from its playlist, but Firefox fires `durationchange` only once
 * the media's metadata has loaded, which for a live stream is after Play. Until then Firefox showed
 * a live stream as a 0:00 video with no live badge. VHS fires `seekablechanged` on the tech each
 * time the playlist moves the seekable window, so the duration is read again then too. The player
 * only reacts when the value actually changes. Returns a function that stops it.
 */
export function syncDurationWithPlaylist(player: DurationPlayerLike): () => void {
  const tech = player.tech({ IWillNotUseThisInPlugins: true });
  if (!tech) return () => undefined;
  const reread = () => tech.trigger('durationchange');
  tech.on('seekablechanged', reread);
  return () => tech.off('seekablechanged', reread);
}
