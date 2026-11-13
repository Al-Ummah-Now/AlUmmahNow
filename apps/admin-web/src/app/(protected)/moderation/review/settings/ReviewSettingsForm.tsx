'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { VIDEO_REVIEW_MODES, type VideoReviewSettings, type VideoReviewThresholds } from '@al-ummah/shared-types';
import { updateReviewSettings } from '@/lib/api/review';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

const THRESHOLDS: Array<keyof VideoReviewThresholds> = ['autoApproveRisk', 'nsfwClear', 'nsfwScreen', 'nsfwHit', 'escalate', 'textFlag'];

export function ReviewSettingsForm({ initial, canEdit }: { initial: VideoReviewSettings; canEdit: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const [s, setS] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const num = (v: string) => (v === '' ? NaN : Number(v));

  const save = async () => {
    if (!canEdit) return;
    setBusy(true);
    setMessage(null);
    const r = await updateReviewSettings({ mode: s.mode, etaMinutes: s.etaMinutes, dailyBudgetUsd: s.dailyBudgetUsd, mediaRetentionDays: s.mediaRetentionDays, thresholds: s.thresholds });
    setBusy(false);
    if (!r.ok) {
      logger.warn('[review] Settings not saved', { status: r.status });
      setMessage({ ok: false, text: t('review.settings.failed') });
      return;
    }
    if (r.data) setS(r.data.settings);
    setMessage({ ok: true, text: t('review.settings.saved') });
    router.refresh();
  };

  return (
    <form className={`${cardClass} max-w-2xl space-y-5`} onSubmit={(e) => { e.preventDefault(); void save(); }} data-testid="review-settings">
      {message && (message.ok ? <p role="status" className="text-fg">{message.text}</p> : <ErrorAlert>{message.text}</ErrorAlert>)}
      {/* Read-only for moderators and reviewers: a disabled fieldset disables every control in it */}
      <fieldset disabled={!canEdit} className="min-w-0 space-y-5">
      <fieldset className="space-y-2">
        <legend className="font-semibold text-fg">{t('review.settings.mode')}</legend>
        {VIDEO_REVIEW_MODES.map((mode) => (
          <label key={mode} className="flex items-center gap-2 text-fg">
            <input type="radio" name="review-mode" value={mode} checked={s.mode === mode} onChange={() => setS({ ...s, mode })} data-testid={`review-mode-${mode}`} />
            {translateDynamic(t, 'review.settings.modes', mode)}
          </label>
        ))}
      </fieldset>
      <div className="grid gap-4 sm:grid-cols-3">
        <label className="space-y-1 text-sm text-fg">
          <span className="block">{t('review.settings.eta')}</span>
          <input type="number" min={1} max={1440} value={s.etaMinutes} onChange={(e) => setS({ ...s, etaMinutes: num(e.target.value) })} className={`${fieldClass} w-full`} />
        </label>
        <label className="space-y-1 text-sm text-fg">
          <span className="block">{t('review.settings.budget')}</span>
          <input type="number" min={0} step={0.5} value={s.dailyBudgetUsd} onChange={(e) => setS({ ...s, dailyBudgetUsd: num(e.target.value) })} className={`${fieldClass} w-full`} />
        </label>
        <label className="space-y-1 text-sm text-fg">
          <span className="block">{t('review.settings.retention')}</span>
          <input type="number" min={1} max={365} value={s.mediaRetentionDays} onChange={(e) => setS({ ...s, mediaRetentionDays: num(e.target.value) })} className={`${fieldClass} w-full`} />
        </label>
      </div>
      <fieldset className="space-y-2">
        <legend className="font-semibold text-fg">{t('review.settings.thresholds')}</legend>
        <div className="grid gap-3 sm:grid-cols-2">
          {THRESHOLDS.map((key) => (
            <label key={key} className="space-y-1 text-sm text-fg">
              <span className="block">{translateDynamic(t, 'review.settings.threshold', key)}</span>
              <input type="number" min={0} max={1} step={0.01} value={s.thresholds[key]} onChange={(e) => setS({ ...s, thresholds: { ...s.thresholds, [key]: num(e.target.value) } })} className={`${fieldClass} w-full`} data-testid={`review-threshold-${key}`} />
            </label>
          ))}
        </div>
      </fieldset>
      </fieldset>
      {canEdit && <button type="submit" disabled={busy} className={primaryButtonClass} data-testid="review-settings-save">{t('review.settings.save')}</button>}
    </form>
  );
}
