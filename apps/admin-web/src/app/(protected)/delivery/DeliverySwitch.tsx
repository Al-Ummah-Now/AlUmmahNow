'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { saveDeliverySettings } from '@/lib/api/admin';
import type { DeliveryAssign, DeliveryMode, DeliverySettings } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, type MessageKey } from '@/i18n/translate';
import { useConfirm } from '@/components/content/actions';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

const MODES: { value: DeliveryMode; label: MessageKey; hint: MessageKey }[] = [
  { value: 'bunny', label: 'mediaDelivery.modeBunny', hint: 'mediaDelivery.modeBunnyHint' },
  { value: 'split', label: 'mediaDelivery.modeSplit', hint: 'mediaDelivery.modeSplitHint' },
  { value: 'r2', label: 'mediaDelivery.modeR2', hint: 'mediaDelivery.modeR2Hint' },
];

const ASSIGNS: { value: DeliveryAssign; label: MessageKey; hint: MessageKey }[] = [
  { value: 'video', label: 'mediaDelivery.assignVideo', hint: 'mediaDelivery.assignVideoHint' },
  { value: 'view', label: 'mediaDelivery.assignView', hint: 'mediaDelivery.assignViewHint' },
];

/** A whole number 0..100, or null. */
export function parsePercent(value: string): number | null {
  if (!/^\s*\d{1,3}\s*$/.test(value)) return null;
  const n = Number(value);
  return n >= 0 && n <= 100 ? n : null;
}

/**
 * The delivery switch: mode, R2 share and assignment (split), and dual-write
 * transcoding. Saving goes through admin-api (media:manage, audited);
 * switching everyone to R2 asks first in the in-app dialog.
 */
export function DeliverySwitch({ settings }: { settings: DeliverySettings }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const { confirm, dialog } = useConfirm();
  const [mode, setMode] = useState<DeliveryMode>(settings.mode);
  const [percent, setPercent] = useState(String(settings.r2Percent));
  const [assign, setAssign] = useState<DeliveryAssign>(settings.assign);
  const [transcode, setTranscode] = useState(settings.transcode);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const pct = parsePercent(percent);
  const percentInvalid = mode === 'split' && pct === null;

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (percentInvalid) return;
    setError(null);
    setNotice(null);
    if (mode === 'r2' && settings.mode !== 'r2') {
      const ok = await confirm({
        title: t('mediaDelivery.confirmR2Title'),
        body: t('mediaDelivery.confirmR2Body'),
        confirmLabel: t('mediaDelivery.confirmR2Confirm'),
        testId: 'delivery-r2-confirm',
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result = await saveDeliverySettings({ mode, r2Percent: pct ?? settings.r2Percent, assign, transcode });
      if (!result.ok) {
        logger.warn('[delivery] Save failed', { status: result.status });
        setError(result.status === 401 ? t('errors.notAuthenticated') : t('mediaDelivery.saveFailed'));
        return;
      }
      setNotice(t('mediaDelivery.saved'));
      router.refresh();
    } catch (e) {
      logger.error('[delivery] Save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('mediaDelivery.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const radio = 'mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={`${ids}-title`} data-testid="delivery-switch" data-mode={settings.mode}>
      {dialog}
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-1">{t('mediaDelivery.switchTitle')}</h2>
      <p className="text-fg-muted text-sm mb-4">{t('mediaDelivery.switchIntro')}</p>
      <form onSubmit={save} className="space-y-5" noValidate>
        <fieldset>
          <legend className="text-sm font-medium text-fg mb-2">{t('mediaDelivery.modeLegend')}</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {MODES.map((m) => (
              <label key={m.value} className="flex items-start gap-2 rounded border border-border p-3 cursor-pointer has-[:checked]:border-accent has-[:checked]:bg-surface-2">
                <input type="radio" name="mode" value={m.value} checked={mode === m.value} onChange={() => setMode(m.value)} className={radio} aria-describedby={`${ids}-${m.value}-hint`} data-testid={`delivery-mode-${m.value}`} />
                <span>
                  <span className="block text-fg font-medium">{t(m.label)}</span>
                  <span id={`${ids}-${m.value}-hint`} className="block text-sm text-fg-muted">{t(m.hint)}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        {mode === 'split' && (
          <div className="grid gap-4 sm:grid-cols-2" data-testid="delivery-split">
            <div className="flex flex-col gap-1">
              <label htmlFor={`${ids}-pct`} className="text-sm font-medium text-fg">{t('mediaDelivery.r2Percent')}</label>
              <input
                id={`${ids}-pct`}
                type="number"
                inputMode="numeric"
                min={0}
                max={100}
                step={1}
                value={percent}
                onChange={(e) => setPercent(e.target.value)}
                aria-invalid={percentInvalid || undefined}
                aria-describedby={`${ids}-pct-hint`}
                className={`${fieldClass} w-32`}
                data-testid="delivery-percent"
              />
              <span id={`${ids}-pct-hint`} className={`text-sm ${percentInvalid ? 'text-danger-fg' : 'text-fg-muted'}`}>{t('mediaDelivery.r2PercentHint')}</span>
            </div>
            <fieldset>
              <legend className="text-sm font-medium text-fg mb-2">{t('mediaDelivery.assignLegend')}</legend>
              <div className="space-y-2">
                {ASSIGNS.map((a) => (
                  <label key={a.value} className="flex items-start gap-2 cursor-pointer">
                    <input type="radio" name="assign" value={a.value} checked={assign === a.value} onChange={() => setAssign(a.value)} className={radio} aria-describedby={`${ids}-${a.value}-hint`} data-testid={`delivery-assign-${a.value}`} />
                    <span>
                      <span className="block text-fg">{t(a.label)}</span>
                      <span id={`${ids}-${a.value}-hint`} className="block text-sm text-fg-muted">{t(a.hint)}</span>
                    </span>
                  </label>
                ))}
              </div>
            </fieldset>
          </div>
        )}

        <label className="flex items-start gap-2 cursor-pointer">
          <input type="checkbox" role="switch" checked={transcode} onChange={(e) => setTranscode(e.target.checked)} className={radio} aria-describedby={`${ids}-transcode-hint`} data-testid="delivery-transcode" />
          <span>
            <span className="block text-fg">{t('mediaDelivery.transcode')}</span>
            <span id={`${ids}-transcode-hint`} className="block text-sm text-fg-muted">{t('mediaDelivery.transcodeHint')}</span>
          </span>
        </label>

        {error && <ErrorAlert testId="delivery-save-error">{error}</ErrorAlert>}
        <div className="flex flex-wrap items-center gap-4">
          <button type="submit" className={`${primaryButtonClass} disabled:opacity-60 disabled:cursor-not-allowed`} disabled={busy || percentInvalid} data-testid="delivery-save">
            {busy ? t('mediaDelivery.saving') : t('mediaDelivery.save')}
          </button>
          <p role="status" className="text-sm text-fg" data-testid="delivery-saved">{notice}</p>
        </div>
        <p className="text-sm text-fg-muted" data-testid="delivery-updated">
          {settings.updatedAt ? t('mediaDelivery.updated', { date: formatDate(settings.updatedAt, locale, true), user: settings.updatedBy ?? '—' }) : t('mediaDelivery.neverChanged')}
        </p>
      </form>
    </section>
  );
}
