'use client';

import { useEffect, useRef } from 'react';
import type { Player } from 'video.js';
import type { LiveProviderId } from '@al-ummah/shared-types';
import { getApiUrl } from '@/lib/runtime-config';
import type { TimedState } from '@/lib/live/api';
import { LiveQoeMonitor, clockOffset, isSampled, liveHostClockOffset, qoeForced, videoJsSource } from '@/lib/live/qoe';

export interface LiveQoeContext {
  streamId: string;
  sessionId: string | null;
  provider: LiveProviderId | null;
  sampleRate: number;
  playbackUrl: string | null;
  /** The state read the player started from (its timing gives the server clock offset). */
  timing: TimedState | null;
}

/**
 * Runs the QoE monitor (lib/live/qoe.ts) on a live player when this page load is
 * sampled. Self-hosted streams read the live host's clock; Bunny ones the API's.
 */
export function useLiveQoe(player: Player | null, attachedAt: number | null, ctx: LiveQoeContext): void {
  const timingRef = useRef(ctx.timing);
  timingRef.current = ctx.timing;
  const { streamId, sessionId, provider, sampleRate, playbackUrl } = ctx;

  useEffect(() => {
    if (!player || !sessionId || !provider || !playbackUrl) return;
    const forced = qoeForced();
    if (!isSampled(sampleRate, { forced })) return;
    let monitor: LiveQoeMonitor | null = null;
    let cancelled = false;
    void (async () => {
      const timing = timingRef.current;
      const apiOffset = timing ? clockOffset({ ...timing, serverNow: timing.state.serverNow ?? null }) : null;
      const offset = provider === 'selfhosted' ? ((await liveHostClockOffset(playbackUrl)) ?? apiOffset) : apiOffset;
      if (cancelled) return;
      monitor = new LiveQoeMonitor(videoJsSource(player as never), {
        streamId,
        sessionId,
        provider,
        beaconUrl: `${getApiUrl().replace(/\/$/, '')}/api/live-streams/${encodeURIComponent(streamId)}/qoe`,
        clockOffsetMs: offset,
        attachedAt: attachedAt ?? undefined,
        expose: forced,
      }).start();
    })();
    return () => {
      cancelled = true;
      monitor?.stop();
    };
  }, [player, attachedAt, streamId, sessionId, provider, sampleRate, playbackUrl]);
}
