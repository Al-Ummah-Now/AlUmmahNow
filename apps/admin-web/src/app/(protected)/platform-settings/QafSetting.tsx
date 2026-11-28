'use client';

import { useId, useState, type FormEvent } from 'react';
import { QAF_LIMITS, localizeDigits, parseDigits, type QafLimits, type QafSettings } from '@al-ummah/shared-types';
import { cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { LocalTime } from '@/components/LocalTime';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import type { ActionResult } from '@/lib/api/errors';

const fields = ['userMinute', 'globalMinute', 'userWeek', 'globalWeek'] as const;
type Patch = Partial<QafLimits> & { key?: string | null };

export function QafSetting({ initial, save }: { initial: QafSettings; save: (input: Patch) => Promise<ActionResult<QafSettings>> }) {
  const { t, locale } = useLanguage();
  const id = useId();
  const [settings, setSettings] = useState(initial);
  const display = (values: QafLimits) => Object.fromEntries(fields.map((key) => [key, localizeDigits(locale, values[key])])) as Record<keyof QafLimits, string>;
  const [limits, setLimits] = useState(() => display(initial));
  const [key, setKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [invalid, setInvalid] = useState(false);
  const [saved, setSaved] = useState(false);

  async function update(patch: Patch) {
    setBusy(true);
    setSaved(false);
    setError(false);
    setInvalid(false);
    try {
      const result = await save(patch);
      if (!result.ok) {
        setInvalid(result.status === 400);
        setError(true);
        return;
      }
      setKey('');
      setSettings(result.data);
      setLimits(display(result.data));
      setSaved(true);
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    const values = fields.map((field) => [field, Number(parseDigits(limits[field].trim()))] as const);
    if (values.some(([field, value]) => !Number.isInteger(value) || value < 1 || value > QAF_LIMITS[field].max)) {
      setInvalid(true);
      setSaved(false);
      setError(true);
      return;
    }
    void update({ ...Object.fromEntries(values), ...(key ? { key } : {}) });
  }

  return (
    <section className={`${cardClass} mb-6`} aria-labelledby={id} data-testid="qaf-settings">
      <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id={id} className="text-lg font-semibold text-fg">{t('qafSettings.title')}</h2>
          <p className="mt-1 text-sm text-fg-muted">{t('qafSettings.subtitle')}</p>
        </div>
        <span className={`rounded px-2 py-1 text-sm font-medium ${settings.connected ? 'bg-chip-resolved-bg text-chip-resolved-fg' : 'bg-surface-2 text-fg-muted'}`}>
          {t(settings.connected ? 'qafSettings.connected' : 'qafSettings.notSet')}
        </span>
      </div>
      {settings.connected && <dl className="mb-4 rounded border border-border bg-surface-2 p-3">
        <dt className="text-sm text-fg-muted">{t('qafSettings.weeklyRemaining')}</dt>
        <dd className="text-xl font-semibold text-fg">{formatNumber(settings.weeklyRemaining, locale)}</dd>
        <dd className="mt-1 text-xs text-fg-muted">{t('qafSettings.weeklyHint')}</dd>
      </dl>}
      {settings.blocked && <p role="status" className="mb-4 text-sm text-danger-fg">
        {t(settings.blocked === 'week' ? 'qafSettings.blockedWeek' : 'qafSettings.blockedKey')}
        {settings.weeklyResetAt && <> <LocalTime withTime value={new Date(settings.weeklyResetAt).toISOString()} /></>}
      </p>}
      <form onSubmit={submit} className="space-y-4">
        <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
          <label className="grid gap-1 text-sm text-fg sm:col-span-2">
            <span className="font-medium">{t('qafSettings.key')}</span>
            <input type="password" dir="ltr" autoComplete="new-password" spellCheck={false} maxLength={256} className={`${fieldClass} w-full max-w-lg`} value={key} onChange={(event) => setKey(event.target.value)} />
            <span className="text-xs text-fg-muted">{t('qafSettings.keyHint')}</span>
          </label>
          {fields.map((field) => <label className="grid gap-1 text-sm text-fg" key={field}>
            <span className="font-medium">{t(`qafSettings.${field}`)}</span>
            <input dir="ltr" className={`${fieldClass} text-left`} inputMode="numeric" maxLength={8} value={limits[field]} onChange={(event) => setLimits((previous) => ({ ...previous, [field]: event.target.value }))} />
            <span className="text-xs text-fg-muted">{t('qafSettings.range', { min: 1, max: QAF_LIMITS[field].max })}</span>
          </label>)}
        </fieldset>
        {error && <p role="alert" className="text-sm text-danger-fg">{t(invalid ? 'qafSettings.invalid' : 'qafSettings.saveFailed')}</p>}
        {saved && <p role="status" className="text-sm text-fg-muted">{t('qafSettings.saved')}</p>}
        <div className="flex flex-wrap gap-2">
          <button type="submit" disabled={busy} className={primaryButtonClass}>{t('qafSettings.save')}</button>
          {settings.connected && <button type="button" disabled={busy} className={secondaryButtonClass} onClick={() => void update({ key: null })}>{t('qafSettings.clear')}</button>}
        </div>
      </form>
    </section>
  );
}
