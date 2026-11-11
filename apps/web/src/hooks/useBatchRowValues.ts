'use client';

/**
 * Values of every batch upload row (lib/upload/set-values.ts): the row's own
 * fields, "Set values" for all or ticked rows, and saving onto each row's
 * video. A row's video exists from the moment its file was picked, so a
 * change is saved at once (debounced), before or while its bytes upload.
 * A publish time is applied once the row's bytes are uploaded (scheduling
 * needs the private, uploaded video).
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { UploadQueueItem, TitleLanguage } from '@al-ummah/shared-types';
import { updateVideo } from '@/lib/api/videos';
import { scheduleUploadedVideo } from '@/lib/api/upload-client';
import { logger } from '@/lib/logger-client';
import type { BulkFormState } from '@/lib/bulk-edit/form';
import {
  applySetValues,
  editRow,
  initialRow,
  rowTitleMissing,
  updateFor,
  type QueueRowRef,
  type RowField,
  type RowState,
  type RowValues,
} from '@/lib/upload/set-values';

export const ROW_SAVE_DEBOUNCE_MS = 700;
export const ROW_SAVE_RETRY_MS = 5000;
const MAX_SAVE_ATTEMPTS = 4;

export type RowSave = 'saving' | 'saved' | 'failed';

/** Rows whose video can take values (not cancelled, not a video uploaded on an earlier visit). */
export function editableRow(file: UploadQueueItem): boolean {
  return !!file.videoId && !file.alreadyUploaded && file.status !== 'cancelled';
}

export function useBatchRowValues(files: UploadQueueItem[], channelId: string, seeded: WeakMap<File, RowValues>) {
  const [rows, setRows] = useState<Record<string, RowState>>({});
  const [save, setSave] = useState<Record<string, RowSave>>({});
  const savedRef = useRef<Record<string, RowValues>>({});
  const attemptsRef = useRef<Record<string, number>>({});
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const inFlightRef = useRef<Set<string>>(new Set());
  const scheduledRef = useRef<Set<string>>(new Set());
  const filesRef = useRef(files);
  filesRef.current = files;
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  // persist and schedule call each other (retry): through a ref
  const scheduleRef = useRef<(rowId: string, delay: number) => void>(() => undefined);

  // New rows start from the values their video was created with
  useEffect(() => {
    setRows((prev) => {
      let next = prev;
      for (const file of files) {
        if (prev[file.id]) continue;
        if (next === prev) next = { ...prev };
        const values = seeded.get(file.file) ?? initialRow(file.file.name).values;
        next[file.id] = { values, touched: [] };
        savedRef.current[file.id] = values;
      }
      return next;
    });
  }, [files, seeded]);

  const persist = useCallback(async (rowId: string) => {
    const file = filesRef.current.find((f) => f.id === rowId);
    const row = rowsRef.current[rowId];
    if (!file || !row || !file.videoId || !editableRow(file) || inFlightRef.current.has(rowId)) return;
    if (rowTitleMissing(row.values)) return;
    const update = updateFor(savedRef.current[rowId] ?? row.values, row.values);
    if (!update) return;
    inFlightRef.current.add(rowId);
    setSave((s) => ({ ...s, [rowId]: 'saving' }));
    let ok = false;
    try {
      const result = await updateVideo(file.videoId, update as Parameters<typeof updateVideo>[1], { channelId });
      ok = !!result?.success;
    } catch (error) {
      logger.warn('[BatchRowValues] Save failed', { videoId: file.videoId, error: error instanceof Error ? error.message : String(error) });
    }
    inFlightRef.current.delete(rowId);
    if (ok) {
      savedRef.current[rowId] = row.values;
      attemptsRef.current[rowId] = 0;
      setSave((s) => ({ ...s, [rowId]: 'saved' }));
      // Edited again while saving: save the newer values
      if (rowsRef.current[rowId] !== row) scheduleRef.current(rowId, ROW_SAVE_DEBOUNCE_MS);
      return;
    }
    const attempts = (attemptsRef.current[rowId] ?? 0) + 1;
    attemptsRef.current[rowId] = attempts;
    setSave((s) => ({ ...s, [rowId]: 'failed' }));
    logger.warn('[BatchRowValues] Row values not saved', { videoId: file.videoId, attempts });
    if (attempts < MAX_SAVE_ATTEMPTS) scheduleRef.current(rowId, ROW_SAVE_RETRY_MS * attempts);
  }, [channelId]);

  const schedule = useCallback((rowId: string, delay: number) => {
    clearTimeout(timersRef.current[rowId]);
    timersRef.current[rowId] = setTimeout(() => void persist(rowId), delay);
  }, [persist]);
  scheduleRef.current = schedule;

  useEffect(() => () => Object.values(timersRef.current).forEach(clearTimeout), []);

  /** The creator typed on one row. */
  const edit = useCallback((rowId: string, field: RowField, values: Partial<RowValues>) => {
    setRows((prev) => (prev[rowId] ? { ...prev, [rowId]: editRow(prev[rowId], field, values) } : prev));
    attemptsRef.current[rowId] = 0;
    schedule(rowId, ROW_SAVE_DEBOUNCE_MS);
  }, [schedule]);

  /** "Set values" for the given rows (queue order). */
  const setValues = useCallback((targets: QueueRowRef[], form: BulkFormState, options: { overwrite: boolean; channel?: Partial<Record<TitleLanguage, string>> }) => {
    const result = applySetValues(rowsRef.current, targets, form, options);
    setRows(result.rows);
    rowsRef.current = result.rows;
    for (const id of result.changed) {
      attemptsRef.current[id] = 0;
      schedule(id, ROW_SAVE_DEBOUNCE_MS);
    }
    logger.info('[BatchRowValues] Values set', { rows: targets.length, changed: result.changed.length, skipped: result.skipped, fields: form.ticked });
    return result;
  }, [schedule]);

  // A publish time is set once the row's bytes are uploaded
  useEffect(() => {
    for (const file of files) {
      const publishAt = rows[file.id]?.values.publishAt;
      if (!publishAt || file.status !== 'completed' || !file.videoId || !editableRow(file) || scheduledRef.current.has(file.id)) continue;
      scheduledRef.current.add(file.id);
      const videoId = file.videoId;
      const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
      void scheduleUploadedVideo(videoId, publishAt, timezone, true, channelId).then((res) => {
        if (!res.success) {
          logger.warn('[BatchRowValues] Schedule failed', { videoId, status: res.status });
          setSave((s) => ({ ...s, [file.id]: 'failed' }));
        }
      });
    }
  }, [files, rows, channelId]);

  return { rows, save, edit, setValues };
}
