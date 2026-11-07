'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { takeAction } from '@/lib/api/admin';
import type { ModerationAction } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import type { MessageKey } from '@/i18n/translate';
import { ErrorAlert, cardClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

interface ReportActionsProps {
  reportId: string;
}

const actionOptions: {
  value: ModerationAction;
  label: MessageKey;
  description: MessageKey;
  color: string;
}[] = [
  {
    value: 'warning',
    label: 'actions.warningLabel',
    description: 'actions.warningDescription',
    color: 'bg-btn-warning hover:bg-btn-warning-hover',
  },
  {
    value: 'removed',
    label: 'actions.removedLabel',
    description: 'actions.removedDescription',
    color: 'bg-btn-removed hover:bg-btn-removed-hover',
  },
  {
    value: 'banned',
    label: 'actions.bannedLabel',
    description: 'actions.bannedDescription',
    color: 'bg-btn-banned hover:bg-btn-banned-hover',
  },
  {
    value: 'dismissed',
    label: 'actions.dismissedLabel',
    description: 'actions.dismissedDescription',
    color: 'bg-btn-dismissed hover:bg-btn-dismissed-hover',
  },
];

export function ReportActions({ reportId }: ReportActionsProps) {
  const router = useRouter();
  const { t } = useLanguage();
  const notesId = useId();
  const groupLabelId = useId();
  const [selectedAction, setSelectedAction] = useState<ModerationAction | null>(null);
  const [notes, setNotes] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const selected = actionOptions.find((a) => a.value === selectedAction);

  const handleSubmit = async () => {
    if (!selectedAction) return;

    setLoading(true);
    setError(null);

    const result = await takeAction(reportId, {
      action: selectedAction,
      notes: notes.trim() || undefined,
    });

    if (!result.ok) {
      logger.warn('[moderation] Action failed', { reportId, action: selectedAction, status: result.status });
      setError(
        result.status === 409
          ? t('actions.alreadyClosed')
          : result.status === 401
            ? t('errors.notAuthenticated')
            : t('actions.failed'),
      );
      setLoading(false);
      return;
    }

    router.push('/moderation');
    router.refresh();
  };

  return (
    <section className={cardClass} aria-labelledby={groupLabelId} data-testid="report-actions">
      <h2 id={groupLabelId} className="text-lg font-semibold text-fg mb-4">
        {t('actions.title')}
      </h2>

      {error && <ErrorAlert testId="action-error">{error}</ErrorAlert>}

      <div className="space-y-3 mb-6" role="group" aria-label={t('actions.choose')}>
        {actionOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            data-action={option.value}
            aria-pressed={selectedAction === option.value}
            onClick={() => setSelectedAction(option.value)}
            className={`w-full text-start p-3 rounded border-2 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
              selectedAction === option.value
                ? 'border-focus bg-surface-hover'
                : 'border-border hover:bg-surface-hover'
            }`}
          >
            <span className="font-medium text-fg">{t(option.label)}</span>
            <span className="block text-sm text-fg-muted">{t(option.description)}</span>
          </button>
        ))}
      </div>

      <div className="mb-6">
        <label htmlFor={notesId} className="block text-fg-muted text-sm mb-2">
          {t('actions.notesLabel')}
        </label>
        <textarea
          id={notesId}
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          dir="auto"
          className="w-full bg-surface-2 border border-border rounded p-3 text-fg resize-none focus:outline-none focus-visible:ring-2 focus-visible:ring-focus"
          rows={3}
          placeholder={t('actions.notesPlaceholder')}
        />
      </div>

      <button
        type="button"
        data-testid="confirm-action"
        onClick={handleSubmit}
        disabled={!selectedAction || loading}
        aria-busy={loading}
        className={`w-full py-3 rounded font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-focus ${
          selected && !loading ? `${selected.color} text-white` : 'bg-surface-hover text-fg-muted cursor-not-allowed'
        }`}
      >
        {loading
          ? t('actions.processing')
          : selected
            ? t('actions.confirm', { action: t(selected.label) })
            : t('actions.selectAction')}
      </button>
    </section>
  );
}
