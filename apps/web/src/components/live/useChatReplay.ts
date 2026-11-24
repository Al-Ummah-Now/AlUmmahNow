'use client';

/**
 * The chat beside a recording (wiki E17 §5.2): what had been written by the moment being watched. Read in
 * 60-second windows as playback reaches them; a seek reads the window it lands in.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import type { Player } from 'video.js';
import type { LiveChatMessage } from '@al-ummah/shared-types';
import { LiveApiError, readChat } from '@/lib/live/api';
import { logger } from '@/lib/logger-client';

export const REPLAY_WINDOW_MS = 60_000;
/** Shown at once; earlier ones are a seek away. */
export const REPLAY_SHOWN = 100;
/** Pages of one window (the server cuts a window that holds more than fits). */
const MAX_PAGES = 5;

/** Every message of the window [from, from + 60 s). */
export async function readWindow(streamId: string, fromMs: number, signal?: AbortSignal): Promise<LiveChatMessage[]> {
  const toMs = fromMs + REPLAY_WINDOW_MS;
  const all = new Map<string, LiveChatMessage>();
  let start = fromMs;
  for (let i = 0; i < MAX_PAGES; i++) {
    const page = await readChat(streamId, { fromMs: start, toMs }, signal);
    for (const m of page.messages) if (m.offsetMs < toMs) all.set(m.id, m);
    const last = page.messages.at(-1);
    if (!page.truncated || !last || last.offsetMs <= start) break;
    start = last.offsetMs;
  }
  return [...all.values()].sort((a, b) => a.offsetMs - b.offsetMs || (a.id < b.id ? -1 : 1));
}

export function useChatReplay(streamId: string, player: Player | null): { messages: LiveChatMessage[]; started: boolean; off: boolean; loading: boolean } {
  const [second, setSecond] = useState(0);
  const [started, setStarted] = useState(false);
  const [off, setOff] = useState(false);
  const [windows, setWindows] = useState<ReadonlyMap<number, LiveChatMessage[]>>(new Map());
  const asked = useRef(new Set<number>());

  useEffect(() => {
    asked.current = new Set();
    setWindows(new Map());
    setOff(false);
  }, [streamId]);

  useEffect(() => {
    if (!player) return;
    const onTime = () => {
      setSecond(Math.floor(player.currentTime() ?? 0));
      setStarted(true);
    };
    player.on('timeupdate', onTime);
    player.on('seeked', onTime);
    return () => {
      player.off('timeupdate', onTime);
      player.off('seeked', onTime);
    };
  }, [player]);

  const current = Math.floor((second * 1000) / REPLAY_WINDOW_MS);
  useEffect(() => {
    if (!started || off) return;
    // The window before, so a seek does not open an empty chat, and the next, so it is there in time
    for (const n of [current, current + 1, current - 1]) {
      if (n < 0 || asked.current.has(n)) continue;
      asked.current.add(n);
      readWindow(streamId, n * REPLAY_WINDOW_MS).then(
        (list) => setWindows((w) => new Map(w).set(n, list)),
        (error) => {
          asked.current.delete(n);
          if (error instanceof LiveApiError && error.status === 404) setOff(true);
          else logger.debug('[LiveChat] Could not read the replay', { streamId, window: n, error });
        },
      );
    }
  }, [current, started, off, streamId]);

  const messages = useMemo(() => {
    const until = second * 1000 + 999;
    // Back from the current window while windows are there without a gap
    const list: LiveChatMessage[] = [];
    for (let n = current; windows.has(n) && list.length < REPLAY_SHOWN; n--) list.unshift(...windows.get(n)!.filter((m) => m.offsetMs <= until));
    return list.slice(-REPLAY_SHOWN);
  }, [windows, current, second]);

  return { messages, started, off, loading: started && !off && !windows.has(current) };
}
