'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getVideoUploadStatus } from '@/lib/api/upload-client';
import { useOptionalWebSocketSubscription } from '@/lib/websocket/WebSocketProvider';
import { logger } from '@/lib/logger-client';
import {
  isTerminalPhase,
  nextProcessingPollDelay,
  phaseFromStatus,
  type ProcessingPhase,
} from '@/lib/upload/processing-status';

/**
 * Live processing status of uploaded videos (upload page, single and batch).
 *
 * Realtime first: the processor pushes `video_processing_update` on the
 * uploader's `user:<id>` channel when processing ends. The status endpoint is
 * polled with backoff as well (5 s → 30 s), so the status still arrives
 * without a websocket. Each video stops being polled once ready or failed.
 * A failed poll keeps the video "processing"; errors are never shown.
 * `forget(id)` drops a video's phase when it is uploaded again (a re-upload of
 * the same video), so its earlier result is not shown for the new upload.
 */
export function useProcessingStatus(
  videoIds: string[],
  channelId: string,
  userId: string | undefined,
): { phases: Record<string, ProcessingPhase>; forget: (videoId: string) => void } {
  const [phases, setPhases] = useState<Record<string, ProcessingPhase>>({});
  const phasesRef = useRef(phases);
  phasesRef.current = phases;

  const settle = useCallback((videoId: string, phase: ProcessingPhase) => {
    setPhases((prev) => (prev[videoId] === phase || isTerminalPhase(prev[videoId]) ? prev : { ...prev, [videoId]: phase }));
  }, []);

  const forget = useCallback((videoId: string) => {
    setPhases((prev) => {
      if (!(videoId in prev)) return prev;
      const next = { ...prev };
      delete next[videoId];
      return next;
    });
  }, []);

  const tracked = useMemo(() => new Set(videoIds.filter(Boolean)), [videoIds]);
  const trackedRef = useRef(tracked);
  trackedRef.current = tracked;

  useOptionalWebSocketSubscription(userId ? `user:${userId}` : '', (data: unknown) => {
    const event = data as { type?: string; videoId?: string; status?: string } | null;
    if (event?.type !== 'video_processing_update' || !event.videoId || !trackedRef.current.has(event.videoId)) return;
    const phase = phaseFromStatus(event.status);
    if (isTerminalPhase(phase)) {
      logger.debug('[useProcessingStatus] Realtime processing result', { videoId: event.videoId, phase });
      settle(event.videoId, phase);
    }
  });

  // Ids still processing, as a stable key: the poll loop restarts only when the set changes
  const pendingKey = [...tracked].filter((id) => !isTerminalPhase(phases[id])).sort().join(',');

  useEffect(() => {
    if (!pendingKey || !channelId) return;
    const ids = pendingKey.split(',');
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let attempt = 0;

    const poll = async () => {
      await Promise.all(
        ids.map(async (videoId) => {
          if (isTerminalPhase(phasesRef.current[videoId])) return;
          try {
            const res = await getVideoUploadStatus(videoId, channelId);
            if (!cancelled && res.success && res.result) settle(videoId, phaseFromStatus(res.result.status));
          } catch (error) {
            logger.warn('[useProcessingStatus] Status poll failed; will retry', { videoId, error });
          }
        }),
      );
      if (cancelled) return;
      timer = setTimeout(poll, nextProcessingPollDelay(++attempt));
    };
    timer = setTimeout(poll, nextProcessingPollDelay(0));
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [pendingKey, channelId, settle]);

  return { phases, forget };
}
