'use client';

/**
 * The playlist adds this page asked for (new uploads → playlists). Each video's
 * adds are requested once its record exists; api-videos queues and retries
 * them. The page reads their status while any is open, sends again a request
 * that did not reach the API, and turns failures into friendly notices.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPlaylistAddStatus, requestPlaylistAdds } from '@/lib/api/upload-playlists-client';
import { isOpen, mergeStatuses, playlistAddNotices, pollDelayMs, WATCH_LIMIT_MS, type PlaylistAddItem } from '@/lib/upload/playlist-adds';
import { reportError } from '@/lib/errors/reporter';
import { logger } from '@/lib/logger-client';

interface Request {
  videoId: string;
  playlistIds: string[];
  orderKey: string;
}

const requestKey = (req: Request) => `${req.videoId}/${req.playlistIds.join(',')}`;

export function usePlaylistAdds(channelId: string) {
  const [items, setItems] = useState<PlaylistAddItem[]>([]);
  const unsentRef = useRef<Map<string, Request>>(new Map());
  const requestedRef = useRef<Set<string>>(new Set());
  const startedAtRef = useRef<number | null>(null);
  const channelRef = useRef(channelId);
  useEffect(() => {
    channelRef.current = channelId;
  }, [channelId]);

  const send = useCallback(async (req: Request) => {
    let answers: Awaited<ReturnType<typeof requestPlaylistAdds>> = null;
    try {
      answers = await requestPlaylistAdds(channelRef.current, req.videoId, req.playlistIds, req.orderKey);
    } catch (error) {
      reportError(error, { extra: { component: 'upload-playlists', step: 'request' } });
    }
    if (answers === null) {
      // Not reached: sent again on the next tick (the API adds a video once only)
      unsentRef.current.set(requestKey(req), req);
      logger.warn('[PlaylistAdds] Request not sent; will send again', { videoId: req.videoId });
      return;
    }
    unsentRef.current.delete(requestKey(req));
    const byPlaylist = new Map(answers.map((a) => [a.playlistId, a.status]));
    setItems((prev) => prev.map((item) => (item.videoId === req.videoId && byPlaylist.has(item.playlistId) ? { ...item, status: byPlaylist.get(item.playlistId)! } : item)));
  }, []);

  /** Asks for a video's adds (once per video and playlist). */
  const queue = useCallback((videoId: string, playlistIds: readonly string[], orderKey: string) => {
    if (!videoId || playlistIds.length === 0) return;
    const fresh = [...new Set(playlistIds)].filter((id) => !requestedRef.current.has(`${videoId}/${id}`));
    if (!fresh.length) return;
    for (const id of fresh) requestedRef.current.add(`${videoId}/${id}`);
    setItems((prev) => [...prev, ...fresh.map((playlistId) => ({ videoId, playlistId, status: 'unsent' as const }))]);
    startedAtRef.current = Date.now();
    void send({ videoId, playlistIds: fresh, orderKey });
  }, [send]);

  // Watch open adds: send unsent requests again, read the status of the rest
  const openKey = items.filter(isOpen).map((i) => `${i.videoId}/${i.playlistId}/${i.status}`).join(',');
  useEffect(() => {
    if (!openKey || startedAtRef.current === null) return;
    const elapsed = Date.now() - startedAtRef.current;
    if (elapsed > WATCH_LIMIT_MS) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      for (const req of [...unsentRef.current.values()]) await send(req);
      const videoIds = [...new Set(openKey.split(',').map((k) => k.split('/')[0]))];
      const answers = await getPlaylistAddStatus(channelRef.current, videoIds).catch((error) => {
        reportError(error, { extra: { component: 'upload-playlists', step: 'status' } });
        return null;
      });
      if (cancelled) return;
      // Same list back: a new array still re-arms the timer for the next read
      setItems((prev) => (answers ? mergeStatuses(prev, answers) : [...prev]));
    }, pollDelayMs(elapsed));
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [openKey, items, send]);

  const notices = useMemo(() => playlistAddNotices(items), [items]);
  return { items, queue, notices };
}
