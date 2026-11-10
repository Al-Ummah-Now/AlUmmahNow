'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { dismissNeedsAction, retryNeedsAction } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';
import type { ItemAction } from '../permissions';

const smallButton =
  'px-3 py-2 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-sm font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60';

/** Retry (the item's registered retry in admin-api) and Dismiss for one needs-action item. */
export function NeedsActionItemButtons({ id, actions, retryLabel }: { id: string; actions: ItemAction[]; retryLabel: string | null }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState<ItemAction | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function retry() {
    setBusy('retry');
    setMessage(null);
    try {
      const result = await retryNeedsAction(id);
      if (result.ok) {
        const { outcome } = result.data;
        setMessage({ ok: outcome.ok, text: t(outcome.ok ? 'errorsPage.retryWorked' : 'errorsPage.retryFailed', { result: outcome.result }) });
      } else {
        logger.warn('[errors] Retry refused', { id, status: result.status });
        setMessage({ ok: false, text: t('errorsPage.failed') });
      }
    } catch (e) {
      logger.error('[errors] Retry request failed', { id, error: e instanceof Error ? e.message : String(e) });
      setMessage({ ok: false, text: t('errorsPage.failed') });
    }
    setBusy(null);
    router.refresh();
  }

  async function dismiss() {
    setBusy('dismiss');
    setMessage(null);
    try {
      const result = await dismissNeedsAction(id);
      if (!result.ok) {
        logger.warn('[errors] Dismiss refused', { id, status: result.status });
        setMessage({ ok: false, text: t('errorsPage.failed') });
      }
    } catch (e) {
      logger.error('[errors] Dismiss request failed', { id, error: e instanceof Error ? e.message : String(e) });
      setMessage({ ok: false, text: t('errorsPage.failed') });
    }
    setBusy(null);
    router.refresh();
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {actions.includes('retry') && (
        <button type="button" className={smallButton} disabled={!!busy} onClick={retry} data-testid="error-item-retry">
          {busy === 'retry' ? t('errorsPage.working') : retryLabel || t('errorsPage.retry')}
        </button>
      )}
      {actions.includes('dismiss') && (
        <button type="button" className={smallButton} disabled={!!busy} onClick={dismiss} data-testid="error-item-dismiss">
          {busy === 'dismiss' ? t('errorsPage.working') : t('errorsPage.dismiss')}
        </button>
      )}
      {message && (
        <span role="status" className={`text-sm ${message.ok ? 'text-fg-muted' : 'text-danger-fg'}`} dir="auto">
          {message.text}
        </span>
      )}
    </div>
  );
}
