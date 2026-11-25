'use client';

/**
 * Media repair on the Videos pages: Sync from Bunny, Retry processing (an R2 failure transcodes again) and Mark
 * failed, for the selected videos (bulk bar on /videos) or one video
 * (/videos/[id]). They use the Processing health actions (admin-api
 * /api/processing, audited there), so the same repair is available wherever
 * an admin finds the video. Admins and super admins only (videos:manage).
 */
import { useState } from 'react';
import type { VideoFailure } from '@al-ummah/shared-types';
import { markProcessingFailed, syncProcessing } from '@/lib/api/admin';
import { retryFailed } from '@/lib/retry-failed';
import { useRetryConfirm } from '@/components/content/failure-retry';
import type { ActionResult } from '@/lib/api/errors';
import type { AdminContentPermission } from '@/lib/api/content-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { fieldClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { smallButtonClass } from '@/components/content/parts';

function useRepair(onDone: () => void) {
  const { t } = useLanguage();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function run(name: string, action: () => Promise<ActionResult<unknown>>, success: string) {
    setBusy(name);
    setError(null);
    setNotice(null);
    let result: ActionResult<unknown>;
    try {
      result = await action();
    } catch (e) {
      logger.error('[videos] Media repair request failed', { name, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(null);
    if (!result.ok) {
      setError(result.status === 401 ? t('errors.notAuthenticated') : t('processing.failed'));
      return;
    }
    setNotice(success);
    onDone();
  }
  return { run, busy, error, notice };
}

function RepairControls({ ids, failures, r2Failed, onDone, testId }: { ids: string[]; failures: Readonly<Record<string, VideoFailure>>; /** Those whose row says so, when why they failed could not be read */ r2Failed?: ReadonlySet<string>; onDone: () => void; testId: string }) {
  const { t } = useLanguage();
  const { run, busy, error, notice } = useRepair(onDone);
  const [reason, setReason] = useState('');
  const { mayRetry, dialog } = useRetryConfirm(failures);
  const count = ids.length;
  const disabled = count === 0 || !!busy;
  return (
    <div className="flex flex-wrap items-end gap-2" data-testid={testId}>
      <button type="button" className={smallButtonClass} disabled={disabled} onClick={() => run('sync', () => syncProcessing(ids, false), t('processing.queued', { count }))} data-testid={`${testId}-sync`}>
        {busy === 'sync' ? t('content.working') : t('processing.sync')}
      </button>
      <button type="button" className={smallButtonClass} disabled={disabled} onClick={async () => (await mayRetry(ids)) && run('retry', () => retryFailed(ids, failures, r2Failed), t('processing.retried', { count }))} data-testid={`${testId}-retry`}>
        {busy === 'retry' ? t('content.working') : t('processing.retry')}
      </button>
      <label className="flex flex-col gap-1 text-xs text-fg-muted">
        {t('processing.markFailedReason')}
        <input className={`${fieldClass} py-1.5`} value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} dir="auto" />
      </label>
      <button
        type="button"
        className={smallButtonClass}
        disabled={disabled}
        onClick={() => run('markFailed', () => markProcessingFailed(ids, reason.trim() || undefined), t('processing.markedFailed', { count }))}
        data-testid={`${testId}-mark-failed`}
      >
        {busy === 'markFailed' ? t('content.working') : t('processing.markFailed')}
      </button>
      <span aria-live="polite" className="basis-full text-sm">
        {error && <span role="alert" className="text-danger-fg">{error}</span>}
        {notice && <span className="text-success-fg">{notice}</span>}
      </span>
      {dialog}
    </div>
  );
}

export interface VideoBulkSlotProps {
  selectedIds: string[];
  /** Why the listed videos failed, by id (the failed ones only) */
  failures: Readonly<Record<string, VideoFailure>>;
  permissions: AdminContentPermission[];
  r2Failed?: ReadonlySet<string>;
  onDone: () => void;
}

/** In the /videos bulk bar (`data-slot="video-bulk-actions-extensions"`). */
export function VideoBulkActionsSlot({ selectedIds, failures, r2Failed, permissions, onDone }: VideoBulkSlotProps): React.ReactNode {
  if (!permissions.includes('videos:manage')) return null;
  return <RepairControls ids={selectedIds} failures={failures} r2Failed={r2Failed} onDone={onDone} testId="video-bulk-repair" />;
}

export interface VideoActionsSlotProps {
  videoId: string;
  failure: VideoFailure | null;
  status: string | null;
  processing: { status: string; encodeProgress: number | null; resolutions: string[] } | null;
  permissions: AdminContentPermission[];
  onDone: () => void;
}

/** On /videos/[id] (`data-slot="video-actions-extensions"`). */
export function VideoActionsSlot({ videoId, failure, permissions, onDone }: VideoActionsSlotProps): React.ReactNode {
  if (!permissions.includes('videos:manage')) return null;
  return <RepairControls ids={[videoId]} failures={failure ? { [videoId]: failure } : {}} onDone={onDone} testId="video-repair" />;
}
