'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { retryContactDelivery } from '@/lib/api/admin';
import type { ContactMailKind } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { logger } from '@/lib/logger-client';

/** Queues a failed email again (contact:manage). */
export function DeliveryRetry({ id, kind, noteId }: { id: string; kind: ContactMailKind; noteId?: string }) {
  const router = useRouter();
  const { t } = useLanguage();
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button
        type="button"
        disabled={busy}
        data-testid={`contact-retry-${kind}${noteId ? `-${noteId}` : ''}`}
        className="px-2 py-1 rounded border border-border bg-surface-2 hover:bg-surface-hover text-fg text-xs font-medium focus:outline-none focus-visible:ring-2 focus-visible:ring-focus disabled:opacity-60"
        onClick={async () => {
          setBusy(true);
          setFailed(false);
          const result = await retryContactDelivery(id, kind, noteId).catch(() => ({ ok: false as const, status: 0, error: 'request failed' }));
          setBusy(false);
          if (!result.ok) {
            logger.warn('[contact] Retry failed', { id, kind, status: result.status });
            setFailed(true);
            return;
          }
          router.refresh();
        }}
      >
        {busy ? t('contact.retrying') : t('contact.retry')}
      </button>
      {failed && (
        <span role="alert" className="text-danger-fg text-xs">
          {t('contact.retryFailed')}
        </span>
      )}
    </span>
  );
}

/** While an email is queued, re-reads the page every few seconds (for about two minutes). */
export function RefreshWhileQueued({ active }: { active: boolean }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    let ticks = 0;
    const timer = setInterval(() => {
      ticks += 1;
      if (ticks > 40) clearInterval(timer);
      router.refresh();
    }, 3000);
    return () => clearInterval(timer);
  }, [active, router]);
  return null;
}
