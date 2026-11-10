'use client';

/**
 * Category state of every batch row: batch default, AI suggestion (read by
 * polling the video's suggestion; the AI request itself was queued by
 * api-videos when the video was created) and the uploader's pick, saved onto
 * the video at once, before or after its upload finishes.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UploadQueueItem, VideoCategory } from '@al-ummah/shared-types';
import { getCategorySuggestion, saveVideoCategory } from '@/lib/api/category-suggestion-client';
import { applyBatchDefault, newBatchRow, pickRow, waitsForSuggestion, withSuggestion, type BatchRowCategory } from '@/lib/category-suggestion/batch';
import { logger } from '@/lib/logger-client';

export const ROW_POLL_MS = 4000;

export function useBatchCategories(files: UploadQueueItem[], batchDefault: VideoCategory | undefined, channelId: string) {
  const [rows, setRows] = useState<Record<string, BatchRowCategory>>({});
  const rowsRef = useRef(rows);
  useEffect(() => {
    rowsRef.current = rows;
  }, [rows]);
  const defaultRef = useRef(batchDefault);

  // New videos start from the default they were created with
  useEffect(() => {
    setRows((prev) => {
      let next = prev;
      for (const file of files) {
        if (!file.videoId || prev[file.videoId]) continue;
        if (next === prev) next = { ...prev };
        next[file.videoId] = newBatchRow(defaultRef.current);
      }
      return next;
    });
  }, [files]);

  const save = useCallback(async (videoId: string, category: VideoCategory | undefined) => {
    let ok = false;
    try {
      ok = await saveVideoCategory(videoId, category ?? null, channelId);
    } catch (error) {
      logger.warn('[BatchCategories] Save failed', { videoId, error: error instanceof Error ? error.message : String(error) });
    }
    setRows((prev) => (prev[videoId] ? { ...prev, [videoId]: { ...prev[videoId], save: ok ? 'saved' : 'failed' } } : prev));
  }, [channelId]);

  // A new default reaches every row nobody picked by hand
  useEffect(() => {
    if (defaultRef.current === batchDefault) return;
    defaultRef.current = batchDefault;
    const next: Record<string, BatchRowCategory> = {};
    const toSave: Array<[string, VideoCategory | undefined]> = [];
    for (const [videoId, row] of Object.entries(rowsRef.current)) {
      const applied = applyBatchDefault(row, batchDefault);
      next[videoId] = applied.row;
      if (applied.save) toSave.push([videoId, applied.row.category]);
    }
    setRows(next);
    toSave.forEach(([videoId, category]) => void save(videoId, category));
  }, [batchDefault, save]);

  // Read the AI's answers, one GET per waiting row per tick (never a new AI request)
  const waiting = Object.entries(rows).filter(([, row]) => waitsForSuggestion(row)).map(([videoId]) => videoId);
  const waitingKey = waiting.join(',');
  useEffect(() => {
    if (!waitingKey) return;
    let cancelled = false;
    const timer = setTimeout(async () => {
      const ids = waitingKey.split(',');
      const answers = await Promise.all(ids.map((videoId) => getCategorySuggestion({ videoId }, channelId).catch(() => null)));
      if (cancelled) return;
      setRows((prev) => {
        const next = { ...prev };
        ids.forEach((videoId, i) => {
          if (next[videoId] && waitsForSuggestion(next[videoId])) next[videoId] = withSuggestion(next[videoId], answers[i]);
        });
        return next;
      });
    }, ROW_POLL_MS);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [waitingKey, rows, channelId]);

  const pick = useCallback((videoId: string, category: VideoCategory | undefined) => {
    setRows((prev) => (prev[videoId] ? { ...prev, [videoId]: pickRow(prev[videoId], category) } : prev));
    void save(videoId, category);
  }, [save]);

  return { rows, pick };
}
