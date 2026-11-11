/**
 * Studio "Edit selected": bulk rename and bulk edit of existing videos.
 *
 *   form (tick fields, live rename preview) → confirm (what changes, on how
 *   many videos) → run (batches of PATCH /api/videos/bulk, progress, Stop)
 *   → result ("48 updated, 2 failed" with reasons, retry the failed ones,
 *   Undo for 24 hours)
 *
 * Only ticked fields are sent; everything else stays as it is.
 */
'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Undo2, RotateCcw } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { bulkEditVideos, undoBulkEdit } from '@/lib/api/videos';
import { getPlaylistById, reorderPlaylistVideos } from '@/lib/api/playlists';
import { placeInOrder, type RenameSubject, type TitleLanguage } from '@al-ummah/shared-types';
import {
  buildBulkRequest,
  emptyBulkForm,
  isEmptyRequest,
  orderedForRename,
  readyFields,
  renamePreview,
  type BulkEditRequest,
  type BulkField,
  type BulkFormState,
} from '@/lib/bulk-edit/form';
import { failureReasons, groupByChannel, newOperationId, runInBatches, type BulkOutcome, type RunProgress } from '@/lib/bulk-edit/runner';
import { BulkDrawer } from './BulkDrawer';
import { BulkFieldsForm, type PlaylistSource } from './BulkFieldsForm';

export interface BulkPanelVideo {
  id: string;
  title?: string;
  titleLocalized?: Partial<Record<string, string>>;
  channelId?: string;
  channelName?: Partial<Record<TitleLanguage, string>>;
  dateCreated?: string;
  originalFilename?: string;
  /** For ordering: when it went (or goes) public, and its length in seconds */
  publishedAt?: string | null;
  duration?: number | null;
}

export const STUDIO_BULK_FIELDS: BulkField[] = ['title', 'description', 'category', 'language', 'visibility', 'playlists', 'tags', 'comments'];

type Step = 'form' | 'confirm' | 'running' | 'result';

interface RunState {
  operationId: string;
  request: BulkEditRequest;
  outcomes: Map<string, BulkOutcome>;
  progress: RunProgress;
  cancelled: boolean;
  undo?: { restored: number; kept: number; failed: number } | null;
  /** The rename order, and whether the playlists added to follow it */
  order: string[];
  playlistOrder: boolean;
  playlistNotice?: string;
}

interface BulkEditPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The selected videos, in the order shown */
  videos: BulkPanelVideo[];
  /** The channel's playlists (null when the selection spans channels) */
  playlists?: PlaylistSource | null;
  knownTags?: string[];
  selectedTags?: string[];
  fields?: BulkField[];
  /** After a run or an undo: the videos that changed (refresh them) */
  onApplied?: (changedIds: string[]) => void;
  /** Titles already on the channel, for "Continue numbering after" */
  loadExistingTitles?: () => Promise<string[]>;
}

export function toSubject(video: BulkPanelVideo, listIndex = 0): RenameSubject {
  return {
    id: video.id,
    title: { en: video.titleLocalized?.en || video.title || '', ar: video.titleLocalized?.ar || '' },
    filename: video.originalFilename,
    date: video.dateCreated ?? null,
    channel: video.channelName,
    listIndex,
    uploadedAt: video.dateCreated ?? null,
    publishedAt: video.publishedAt ?? null,
    duration: video.duration ?? null,
  };
}

export function BulkEditPanel({ open, onOpenChange, videos, playlists = null, knownTags = [], selectedTags = [], fields = STUDIO_BULK_FIELDS, onApplied, loadExistingTitles }: BulkEditPanelProps) {
  const { t, lang } = useLanguage();
  const b = t.bulkEdit;
  const ui: TitleLanguage = lang === 'ar' ? 'ar' : 'en';
  const fmt = (n: number) => n.toLocaleString(lang === 'ar' ? 'ar' : 'en-US');
  const [form, setForm] = useState<BulkFormState>(() => emptyBulkForm(ui));
  const [step, setStep] = useState<Step>('form');
  const [run, setRun] = useState<RunState | null>(null);
  const [busyUndo, setBusyUndo] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const subjects = useMemo(() => videos.map((v, i) => toSubject(v, i)), [videos]);
  const byId = useMemo(() => new Map(videos.map((v) => [v.id, v])), [videos]);
  const offered = useMemo(() => fields.filter((f) => f !== 'playlists' || !!playlists), [fields, playlists]);
  const hideTokens = videos.some((v) => v.originalFilename) ? [] : ['{filename}'];

  useEffect(() => {
    if (!open) return;
    setForm(emptyBulkForm(ui));
    setStep('form');
    setRun(null);
    setError(null);
  }, [open, ui]);

  const preview = useMemo(() => (form.ticked.includes('title') ? renamePreview(form, subjects) : undefined), [form, subjects]);
  const ready = readyFields(form, preview);
  const names: Record<BulkField, string> = {
    title: b.fields.title, description: b.fields.description, category: b.fields.category, language: b.fields.language,
    visibility: b.fields.visibility, playlists: b.fields.playlists, tags: b.fields.tags, schedule: b.fields.schedule, comments: b.fields.comments,
  };
  const listFormat = (items: string[]) => {
    try {
      return new Intl.ListFormat(lang === 'ar' ? 'ar' : 'en', { type: 'conjunction' }).format(items);
    } catch {
      return items.join(', ');
    }
  };

  const titleOf = (id: string) => {
    const v = byId.get(id);
    return (ui === 'ar' ? v?.titleLocalized?.ar : v?.titleLocalized?.en) || v?.title || id;
  };

  const execute = async (ids: string[], state: Pick<RunState, 'operationId' | 'request' | 'order' | 'playlistOrder'>, previous?: Map<string, BulkOutcome>) => {
    const controller = new AbortController();
    abortRef.current = controller;
    const total = ids.length;
    setStep('running');
    setRun({ ...state, outcomes: previous ?? new Map(), progress: { done: 0, total, succeeded: 0, failed: 0 }, cancelled: false });
    const groups = groupByChannel(ids, (id) => byId.get(id)?.channelId || '');
    logger.info('[BulkEditPanel] Bulk edit started', { operationId: state.operationId, total, fields: Object.keys(state.request.changes), titles: Object.keys(state.request.titles).length });
    const result = await runInBatches(groups, (batch, channelId) => {
      const perVideo: Record<string, { title?: { en?: string; ar?: string } }> = {};
      for (const id of batch) if (state.request.titles[id]) perVideo[id] = { title: state.request.titles[id] };
      // A video whose only change is its title and whose new title is blocked has nothing to send
      return bulkEditVideos({ ids: batch, operationId: state.operationId, changes: state.request.changes as Record<string, unknown>, ...(Object.keys(perVideo).length ? { perVideo } : {}) }, { channelId });
    }, {
      signal: controller.signal,
      onProgress: (progress) => setRun((r) => (r ? { ...r, progress } : r)),
    });
    const outcomes = new Map(previous ?? []);
    result.outcomes.forEach((o, id) => outcomes.set(id, o));
    const succeeded = Array.from(outcomes.values()).filter((o) => o.success).length;
    const failed = Array.from(outcomes.values()).filter((o) => !o.success).length;
    setRun({ ...state, outcomes, progress: { done: result.done, total, succeeded, failed }, cancelled: result.cancelled });
    setStep('result');
    abortRef.current = null;
    logger.info('[BulkEditPanel] Bulk edit finished', { operationId: state.operationId, succeeded, failed, cancelled: result.cancelled });
    if (failed > 0 && succeeded === 0) reportError(new Error('Bulk edit failed for every video'), { shown: true, extra: { operationId: state.operationId, failed, reasons: failureReasons(outcomes.values()).map((r) => `${r.code}:${r.count}`).join(',') } });
    if (state.playlistOrder && !result.cancelled) {
      const playlistNotice = await orderPlaylists(state, outcomes);
      setRun((r) => (r ? { ...r, playlistNotice } : r));
    }
    const changed = Array.from(result.outcomes.values()).filter((o) => o.success && o.changed).map((o) => o.videoId);
    if (changed.length) onApplied?.(changed);
  };

  /** "Also order in playlist": the edited videos together, in the rename order, in each playlist they were added to. */
  const orderPlaylists = async (state: Pick<RunState, 'request' | 'order'>, outcomes: Map<string, BulkOutcome>): Promise<string> => {
    const selection = state.order.filter((id) => outcomes.get(id)?.success);
    const channelId = byId.get(selection[0] ?? '')?.channelId || '';
    let skipped = false;
    for (const playlistId of state.request.changes.addPlaylists ?? []) {
      try {
        const playlist = await getPlaylistById(playlistId);
        if (!playlist) continue;
        if (playlist.sortMode === 'auto') {
          skipped = true;
          continue;
        }
        const saved = await reorderPlaylistVideos(playlistId, placeInOrder(playlist.videos ?? [], selection), { channelId });
        logger.info('[BulkEditPanel] Playlist ordered', { playlistId, count: selection.length, ok: saved.ok });
        if (!saved.ok) skipped = true;
      } catch (error) {
        logger.warn('[BulkEditPanel] Playlist order failed', { playlistId, error: error instanceof Error ? error.message : String(error) });
        skipped = true;
      }
    }
    return skipped ? b.playlistOrderSkipped : b.playlistOrdered;
  };

  // Sent in the rename order: playlist adds append in it too
  const orderedIds = () => orderedForRename(form, subjects).map((s) => s.id);
  const idsToSend = (request: BulkEditRequest) => {
    // With only titles changing, a video without an applicable new title is left out
    if (Object.keys(request.changes).length === 0 && Object.keys(request.publishAt).length === 0) return orderedIds().filter((id) => request.titles[id]);
    return orderedIds();
  };

  const start = () => {
    const request = buildBulkRequest(form, subjects);
    if (isEmptyRequest(request)) {
      setError(b.nothingToApply);
      return;
    }
    void execute(idsToSend(request), { operationId: newOperationId(), request, order: orderedIds(), playlistOrder: form.playlistOrder && !!request.changes.addPlaylists?.length });
  };

  const retryFailed = () => {
    if (!run) return;
    // In the rename order, so playlist adds keep it
    const failedIds = run.order.filter((id) => run.outcomes.get(id)?.success === false);
    const notSent = run.cancelled ? idsToSend(run.request).filter((id) => !run.outcomes.has(id)) : [];
    const kept = new Map(Array.from(run.outcomes).filter(([, o]) => o.success));
    void execute([...failedIds, ...notSent], run, kept);
  };

  const undo = async () => {
    if (!run) return;
    setBusyUndo(true);
    const ids = videos.map((v) => v.id).filter((id) => { const o = run.outcomes.get(id); return !!o && o.success && (o.changed || o.replayed); });
    const groups = groupByChannel(ids, (id) => byId.get(id)?.channelId || '');
    const result = await runInBatches(groups, (batch, channelId) => undoBulkEdit(run.operationId, batch, { channelId }));
    const outcomes = Array.from(result.outcomes.values());
    const restored = outcomes.filter((o) => o.success && o.code !== 'changed_since' && o.code !== 'nothing_to_undo').length;
    const kept = outcomes.filter((o) => o.code === 'changed_since').length;
    const failed = outcomes.filter((o) => !o.success).length;
    logger.info('[BulkEditPanel] Bulk edit undone', { operationId: run.operationId, restored, kept, failed });
    setRun((r) => (r ? { ...r, undo: { restored, kept, failed } } : r));
    setBusyUndo(false);
    onApplied?.(outcomes.filter((o) => o.success).map((o) => o.videoId));
  };

  const progress = run?.progress;
  const reasons = run ? failureReasons(run.outcomes.values()) : [];
  const failedOutcomes = run ? Array.from(run.outcomes.values()).filter((o) => !o.success) : [];

  const footer = step === 'form' ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {error && <p role="alert" className="me-auto text-sm text-[var(--fanous-color-error-text)]" data-testid="bulk-edit-error">{error}</p>}
      <button type="button" className="b b-secondary" onClick={() => onOpenChange(false)}>{b.cancel}</button>
      <button type="button" className="b b-primary" disabled={ready.length === 0} onClick={() => { setError(null); setStep('confirm'); }} data-testid="bulk-edit-review">
        {b.review}
      </button>
    </div>
  ) : step === 'confirm' ? (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className="b b-secondary" onClick={() => setStep('form')} data-testid="bulk-edit-back">{b.back}</button>
      <button type="button" className="b b-primary" onClick={start} data-testid="bulk-edit-apply">{b.confirmApply}</button>
    </div>
  ) : step === 'running' ? (
    <div className="flex justify-end">
      <button type="button" className="b b-secondary" onClick={() => abortRef.current?.abort()} data-testid="bulk-edit-stop">{b.cancelRun}</button>
    </div>
  ) : (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <button type="button" className="b b-primary" onClick={() => onOpenChange(false)} data-testid="bulk-edit-done">{b.close}</button>
    </div>
  );

  return (
    <BulkDrawer
      open={open}
      onOpenChange={onOpenChange}
      locked={step === 'running' || busyUndo}
      title={b.panelTitle.replace('{count}', fmt(videos.length))}
      description={b.panelIntro}
      footer={footer}
      testId="bulk-edit-panel"
    >
      {/* One polite live region for progress and results */}
      <p className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="bulk-edit-live">
        {step === 'running' && progress ? b.progress.replace('{done}', fmt(progress.done)).replace('{total}', fmt(progress.total)) : ''}
        {step === 'result' && progress ? (progress.failed ? b.partial.replace('{succeeded}', fmt(progress.succeeded)).replace('{failed}', fmt(progress.failed)) : b.done.replace('{count}', fmt(progress.succeeded))) : ''}
      </p>

      {step === 'form' && (
        <BulkFieldsForm variant="edit" form={form} onChange={setForm} subjects={subjects} fields={offered}
          playlists={playlists} knownTags={knownTags} selectedTags={selectedTags} hideTokens={hideTokens} loadExistingTitles={loadExistingTitles} />
      )}

      {step === 'confirm' && (
        <div className="space-y-3" data-testid="bulk-edit-confirm">
          <h3 className="text-base font-semibold">{b.confirmTitle.replace('{count}', fmt(idsToSend(buildBulkRequest(form, subjects)).length))}</h3>
          <p className="text-sm text-[var(--fanous-color-text-secondary)]">{b.confirmBody.replace('{fields}', listFormat(ready.map((f) => names[f])))}</p>
          <ul className="space-y-1 text-sm">
            {offered.map((f) => (
              <li key={f} className="flex justify-between gap-2 border-b border-[var(--fanous-color-divider)] py-1" data-testid={`bulk-edit-confirm-${f}`} data-changes={ready.includes(f) ? 'true' : 'false'}>
                <span>{names[f]}</span>
                <span className={ready.includes(f) ? 'font-semibold text-[var(--fanous-color-text-primary)]' : 'text-[var(--fanous-color-text-secondary)]'}>
                  {ready.includes(f) ? b.willChange : b.untouched}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {step === 'running' && progress && (
        <div className="space-y-3" data-testid="bulk-edit-running" data-done={progress.done} data-total={progress.total}>
          <p className="text-sm">{b.progress.replace('{done}', fmt(progress.done)).replace('{total}', fmt(progress.total))}</p>
          <div
            className="h-2 w-full overflow-hidden rounded-full bg-[var(--fanous-color-divider)]"
            role="progressbar"
            aria-label={b.progress.replace('{done}', fmt(progress.done)).replace('{total}', fmt(progress.total))}
            aria-valuemin={0}
            aria-valuemax={progress.total}
            aria-valuenow={progress.done}
          >
            <div className="h-full bg-[var(--fanous-color-primary)] transition-all" style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} />
          </div>
        </div>
      )}

      {step === 'result' && run && progress && (
        <div className="space-y-4" data-testid="bulk-edit-result" data-succeeded={progress.succeeded} data-failed={progress.failed} data-operation-id={run.operationId}>
          <h3 className="text-base font-semibold">{b.resultTitle}</h3>
          <p className="flex items-center gap-2 text-sm" data-testid="bulk-edit-summary">
            {progress.failed ? <AlertTriangle className="h-5 w-5 text-[var(--fanous-color-error-text)]" aria-hidden="true" /> : <CheckCircle2 className="h-5 w-5 text-[var(--fanous-color-success-text)]" aria-hidden="true" />}
            {progress.failed
              ? b.partial.replace('{succeeded}', fmt(progress.succeeded)).replace('{failed}', fmt(progress.failed))
              : b.done.replace('{count}', fmt(progress.succeeded))}
          </p>
          {run.cancelled && <p className="text-sm text-[var(--fanous-color-text-secondary)]" data-testid="bulk-edit-cancelled">{b.cancelled.replace('{done}', fmt(progress.done)).replace('{total}', fmt(progress.total))}</p>}

          {failedOutcomes.length > 0 && (
            <div>
              <ul className="mb-2 flex flex-wrap gap-2 text-xs" data-testid="bulk-edit-reasons">
                {reasons.map((r) => (
                  <li key={r.code} className="rounded-full border border-[var(--fanous-color-outline)] px-2 py-0.5">
                    {(b.reasons[r.code] ?? b.reasons.failed)} ({fmt(r.count)})
                  </li>
                ))}
              </ul>
              <details>
                <summary className="cursor-pointer text-sm font-medium">{b.failedList}</summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto text-sm" data-testid="bulk-edit-failed-list">
                  {failedOutcomes.map((o) => (
                    <li key={o.videoId} className="flex justify-between gap-2">
                      <bdi className="truncate">{titleOf(o.videoId)}</bdi>
                      <span className="shrink-0 text-[var(--fanous-color-error-text)]">{b.reasons[o.code ?? 'failed'] ?? b.reasons.failed}</span>
                    </li>
                  ))}
                </ul>
              </details>
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {(failedOutcomes.length > 0 || run.cancelled) && (
              <button type="button" className="b b-secondary" onClick={retryFailed} data-testid="bulk-edit-retry">
                <RotateCcw aria-hidden="true" />
                {b.retryFailed.replace('{count}', fmt(failedOutcomes.length + (run.cancelled ? progress.total - progress.done : 0)))}
              </button>
            )}
            {progress.succeeded > 0 && !run.undo && (
              <button type="button" className="b b-secondary" onClick={() => void undo()} disabled={busyUndo} data-testid="bulk-edit-undo" aria-describedby="bulk-edit-undo-hint">
                <Undo2 aria-hidden="true" />
                {busyUndo ? b.undoing : b.undo}
              </button>
            )}
          </div>
          {progress.succeeded > 0 && !run.undo && <p id="bulk-edit-undo-hint" className="text-xs text-[var(--fanous-color-text-secondary)]">{b.undoHint}</p>}
          {run.playlistNotice && <p role="status" className="text-sm" data-testid="bulk-edit-playlist-order-result">{run.playlistNotice}</p>}
          {run.undo && (
            <p role="status" className="text-sm" data-testid="bulk-edit-undone" data-restored={run.undo.restored} data-kept={run.undo.kept}>
              {run.undo.kept
                ? b.undoPartial.replace('{restored}', fmt(run.undo.restored)).replace('{kept}', fmt(run.undo.kept))
                : b.undone.replace('{count}', fmt(run.undo.restored))}
            </p>
          )}
        </div>
      )}
    </BulkDrawer>
  );
}

export default BulkEditPanel;
