/**
 * Where a premiere is (wiki E17 §5.4): everyone sees the same moment, `serverNow - startedAt`. The server's
 * clock is taken from the state answer, so a wrong clock on the device does not matter.
 */
import { useEffect, useRef, useState } from 'react';
import { clockOffset } from '@/lib/live/qoe';
import type { TimedState } from '@/lib/live/api';

/** Further from the moment than this, playback is brought back to it. */
export const RESYNC_SECONDS = 3;
/** Nobody gets ahead of it by more than the jitter of a seek. */
const AHEAD_SECONDS = 1;
/** HAVE_FUTURE_DATA: below it the player is buffering, and another seek would only make it start over. */
const PLAYABLE = 3;

export const serverOffset = (timed: TimedState | null): number => (timed ? (clockOffset({ ...timed, serverNow: timed.state.serverNow ?? null }) ?? 0) : 0);

/** Seconds into the video now, between 0 and its length. */
export function premierePosition(startedAt: number, offset: number, duration: number | null, now = Date.now()): number {
  const at = Math.max(0, (now + offset - startedAt) / 1000);
  return duration ? Math.min(at, duration) : at;
}

/** What is used of the Video.js player (its own typings leave some of it out). */
export interface SyncedPlayer {
  currentTime(): number | undefined;
  currentTime(seconds: number): void;
  playbackRate(): number;
  playbackRate(rate: number): void;
  paused(): boolean;
  seeking(): boolean;
  ended(): boolean;
  readyState(): number;
  play(): Promise<void> | void;
  on(event: string, fn: () => void): void;
  off(event: string, fn: () => void): void;
}

export interface PremiereClock {
  startedAt: number;
  offset: number;
  duration: number | null;
}

/**
 * Keeps the player at the premiere's moment while `clock` is set. A viewer may pause or go back: they are
 * then `behind`, until they catch up or return. Going ahead is not possible.
 */
export function usePremiereSync(player: SyncedPlayer | null, clock: PremiereClock | null): { behind: boolean; returnToLive: () => void } {
  const [behind, setBehind] = useState(false);
  const following = useRef(true);
  // Every state read moves the offset by a few milliseconds: that is no reason to attach again
  const clockRef = useRef(clock);
  clockRef.current = clock;
  const on = !!clock;

  useEffect(() => {
    setBehind(false);
    if (!player || !on) return;
    following.current = true;
    let started = false;
    const position = () => (clockRef.current ? premierePosition(clockRef.current.startedAt, clockRef.current.offset, clockRef.current.duration) : 0);
    const over = () => !!clockRef.current?.duration && position() >= clockRef.current.duration;
    const toMoment = () => player.currentTime(position());
    const drift = () => position() - (player.currentTime() ?? 0);
    const tick = () => {
      if (over()) return setBehind(false);
      // Caught up, or past it between two ticks (a late tick, a background tab); a viewer who has just paused
      // is at the moment too, and stays paused there
      if (!following.current && !player.paused() && drift() <= AHEAD_SECONDS) following.current = true;
      if (following.current) {
        // Faster or slower than everyone else only while catching up
        if (player.playbackRate() !== 1) player.playbackRate(1);
        // Ahead is taken back at once, behind only when it is more than a hiccup
        const off = drift();
        if (!player.paused() && !player.seeking() && player.readyState() >= PLAYABLE && (off > RESYNC_SECONDS || off < -AHEAD_SECONDS)) toMoment();
      }
      setBehind(!following.current && drift() > RESYNC_SECONDS);
    };
    const onLoaded = () => { if (following.current && !over()) toMoment(); };
    const onPlaying = () => {
      started = true;
      tick();
    };
    const onPause = () => {
      if (started && !over() && !player.ended()) following.current = false;
    };
    const onSeeking = () => {
      const ahead = -drift();
      if (ahead > AHEAD_SECONDS) {
        following.current = true;
        toMoment();
      } else if (started) following.current = -ahead <= RESYNC_SECONDS;
      tick();
    };
    if (player.readyState() >= 1) onLoaded();
    player.on('loadedmetadata', onLoaded);
    player.on('playing', onPlaying);
    player.on('pause', onPause);
    player.on('seeking', onSeeking);
    const timer = setInterval(tick, 1000);
    return () => {
      clearInterval(timer);
      player.off('loadedmetadata', onLoaded);
      player.off('playing', onPlaying);
      player.off('pause', onPause);
      player.off('seeking', onSeeking);
    };
  }, [player, on]);

  const returnToLive = () => {
    if (!player || !clock) return;
    following.current = true;
    setBehind(false);
    player.currentTime(premierePosition(clock.startedAt, clock.offset, clock.duration));
    void Promise.resolve(player.play()).catch(() => undefined);
  };
  return { behind, returnToLive };
}
