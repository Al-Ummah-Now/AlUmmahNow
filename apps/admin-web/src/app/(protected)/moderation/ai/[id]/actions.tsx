'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { reviewAiSignal, setAiSignalVisibility } from '@/lib/api/admin';
import { useLanguage } from '@/i18n/I18nProvider';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

interface SignalActionsProps {
  signalId: string;
  canHide: boolean;
  hidden: boolean;
}

export function SignalActions({ signalId, canHide, hidden }: SignalActionsProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const noteId = useId();
  const headingId = useId();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function run(label: string, action: () => Promise<{ ok: boolean; status?: number }>) {
    setBusy(true);
    setError(null);
    try {
      const result = await action();
      if (!result.ok) {
        logger.warn('[ai-moderation] Action failed', { signalId, label, status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('ai.actionFailed'));
        return;
      }
      router.refresh();
    } catch (e) {
      logger.error('[ai-moderation] Action request failed', { signalId, label, error: e instanceof Error ? e.message : String(e) });
      setError(t('ai.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  const trimmed = note.trim() || undefined;

  return (
    <section className={`${cardClass} h-fit space-y-4`} aria-labelledby={headingId} data-testid="ai-actions">
      <h2 id={headingId} className="text-lg font-semibold text-fg">{t('ai.reviewTitle')}</h2>
      {error && <ErrorAlert testId="ai-action-error">{error}</ErrorAlert>}

      <div>
        <label htmlFor={noteId} className="block text-fg-muted text-sm mb-2">{t('ai.noteLabel')}</label>
        <textarea id={noteId} value={note} onChange={(e) => setNote(e.target.value)} dir="auto" rows={2} maxLength={500} className={`${fieldClass} w-full`} />
      </div>

      <div className="flex flex-col gap-2">
        <button type="button" data-testid="ai-agree" disabled={busy} aria-busy={busy} className={primaryButtonClass} onClick={() => run('agree', () => reviewAiSignal(signalId, 'agree', trimmed))}>
          {busy ? t('ai.working') : t('ai.agree')}
        </button>
        <button type="button" data-testid="ai-disagree" disabled={busy} className={secondaryButtonClass} onClick={() => run('disagree', () => reviewAiSignal(signalId, 'disagree', trimmed))}>
          {t('ai.disagree')}
        </button>
      </div>

      <div className="border-t border-border pt-4">
        {canHide ? (
          <>
            <button
              type="button"
              data-testid={hidden ? 'ai-restore' : 'ai-hide'}
              disabled={busy}
              className={`${secondaryButtonClass} w-full`}
              onClick={() => run(hidden ? 'restore' : 'hide', () => setAiSignalVisibility(signalId, !hidden, trimmed))}
            >
              {hidden ? t('ai.restore') : t('ai.hide')}
            </button>
            <p className="text-xs text-fg-subtle mt-2">{t('ai.hideHint')}</p>
          </>
        ) : (
          <p className="text-sm text-fg-muted">{t('ai.hideUnsupported')}</p>
        )}
      </div>
    </section>
  );
}
