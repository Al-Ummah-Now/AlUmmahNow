'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { startIndexRebuild } from '@/lib/api/admin';
import type { ActionResult } from '@/lib/api/errors';
import type { AdminJob } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

/**
 * Rebuild for an "Index out of sync" row: queues the ownership index rebuild
 * job (admin-api /api/processing/index-rebuild → api-videos admin job
 * 'search.rebuild-ownership', retried with backoff, failed jobs listed below
 * with Retry). A rebuild already running is reported instead of queuing another.
 */
export function IndexRebuildButton({ kind, active }: { kind: 'video' | 'channel' | 'profile'; active: boolean }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);

  async function rebuild() {
    setBusy(true);
    setMessage(null);
    let result: ActionResult<{ job: AdminJob; existing: boolean }>;
    try {
      result = await startIndexRebuild(kind);
    } catch (e) {
      logger.error('[errors] Index rebuild request failed', { kind, error: e instanceof Error ? e.message : String(e) });
      result = { ok: false, status: 0, error: 'request failed' };
    }
    setBusy(false);
    if (!result.ok) {
      logger.warn('[errors] Index rebuild refused', { kind, status: result.status });
      setMessage({ text: result.status === 401 ? t('errors.notAuthenticated') : t('errorsPage.rebuildFailed'), error: true });
      return;
    }
    setMessage({ text: t(result.data.existing ? 'errorsPage.rebuildRunning' : 'errorsPage.rebuildQueued'), error: false });
    router.refresh();
  }

  return (
    <div className="flex flex-col items-start gap-1">
      <button type="button" className={secondaryButtonClass} onClick={() => void rebuild()} disabled={busy || active} data-testid={`index-rebuild-${kind}`}>
        {busy ? t('errorsPage.rebuilding') : t('errorsPage.rebuild')}
      </button>
      {message && (
        <p role={message.error ? 'alert' : 'status'} className={`text-xs ${message.error ? 'text-danger-fg' : 'text-fg-muted'}`}>
          {message.text}
        </p>
      )}
    </div>
  );
}
