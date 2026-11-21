'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { listQuranEditions, resetQuranEdition, saveCaptionSettings, setQuranEdition, type CaptionSettings, type CaptionSettingsView as View } from '@/lib/api/captions';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass, secondaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { UserName } from '@/components/audit/UserName';
import { fillNodes } from '@/components/audit/fill';
import { parseDigits } from '@al-ummah/shared-types';
import { NumberField } from '@/components/forms/NumberField';
import { Select } from '@/components/select/Select';

import { LocalTime } from '@/components/LocalTime';
const MODELS = [
  { id: '@cf/deepseek-ai/deepseek-v4.1-flash-1017', name: 'DeepSeek V4.1 Flash' },
  { id: '@cf/google/gemma-4-26b-a4b-it', name: 'Gemma 4 26B' },
];
const checkbox = 'mt-1 h-4 w-4 shrink-0 accent-accent focus:outline-none focus-visible:ring-2 focus-visible:ring-focus';
const LANG = /^[a-z]{2,3}$/;

/**
 * Captions & translation: the caption budget, transcript translation (models, DeepL), inline
 * title/description translation (kill switch, fair use, budget), viewer-side titles and the
 * platform's Quran translation edition per language.
 */
export function CaptionSettingsView({ view, canManage }: { view: View; canManage: boolean }) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [form, setForm] = useState<CaptionSettings>(view.settings);
  const [deeplLanguages, setDeeplLanguages] = useState(view.settings.translation.deeplLanguages.join(', '));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const setTranslation = (patch: Partial<CaptionSettings['translation']>) => setForm((f) => ({ ...f, translation: { ...f.translation, ...patch } }));
  const setInline = (patch: Partial<CaptionSettings['inline']>) => setForm((f) => ({ ...f, inline: { ...f.inline, ...patch } }));

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!canManage) return;
    const languages = deeplLanguages.split(/[\s,]+/).map((l) => l.trim().toLowerCase()).filter(Boolean);
    if (languages.some((l) => !LANG.test(l))) {
      setError(t('captionSettings.invalidLanguages'));
      return;
    }
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await saveCaptionSettings({ ...form, translation: { ...form.translation, deeplLanguages: languages } });
      if (!result.ok) {
        logger.warn('[caption-settings] Save failed', { status: result.status });
        setError(result.status === 403 ? t('captionSettings.forbidden') : t('captionSettings.saveFailed'));
        return;
      }
      setNotice(t('captionSettings.saved'));
      router.refresh();
    } catch (e) {
      logger.error('[caption-settings] Save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('captionSettings.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  const usage = (kind: 'inline' | 'caption' | 'viewer') => view.translations30d.find((r) => r.kind === kind);

  return (
    <div className="space-y-6" data-testid="caption-settings">
      <form onSubmit={save} className="space-y-6" noValidate>
        <fieldset disabled={!canManage || busy} className="space-y-6">
          <section className={cardClass} aria-labelledby={`${ids}-budget`}>
            <h2 id={`${ids}-budget`} className="text-lg font-semibold text-fg mb-1">{t('captionSettings.budgetTitle')}</h2>
            <p className="text-sm text-fg-muted mb-4">{t('captionSettings.budgetHint')}</p>
            <label className="block text-sm font-medium text-fg" htmlFor={`${ids}-budget-usd`}>{t('captionSettings.monthlyBudget')}</label>
            <NumberField decimal
              id={`${ids}-budget-usd`}
              min={0}
              max={500}
              step={1}
              className={`${fieldClass} mt-1 w-40`}
              value={form.monthlyBudgetUsd}
              onChange={(e) => setForm((f) => ({ ...f, monthlyBudgetUsd: Number(parseDigits(e.target.value)) }))}
              data-testid="caption-budget"
            />
          </section>

          <section className={cardClass} aria-labelledby={`${ids}-translation`}>
            <h2 id={`${ids}-translation`} className="text-lg font-semibold text-fg mb-1">{t('captionSettings.translationTitle')}</h2>
            <p className="text-sm text-fg-muted mb-4">{t('captionSettings.translationHint')}</p>
            <label className="flex items-start gap-2 mb-4">
              <input type="checkbox" className={checkbox} checked={form.translation.enabled} onChange={(e) => setTranslation({ enabled: e.target.checked })} data-testid="translation-enabled" />
              <span className="text-fg">{t('captionSettings.translationEnabled')}</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              {(['model', 'fallbackModel'] as const).map((key) => (
                <div key={key}>
                  <label className="block text-sm font-medium text-fg" htmlFor={`${ids}-${key}`}>{t(key === 'model' ? 'captionSettings.model' : 'captionSettings.fallbackModel')}</label>
                  <Select id={`${ids}-${key}`} className={`${fieldClass} mt-1 w-full`} value={form.translation[key]} onChange={(e) => setTranslation({ [key]: e.target.value })} data-testid={`translation-${key}`}>
                    {MODELS.map((m) => (
                      <option key={m.id} value={m.id}>{m.name}</option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={form.translation.deepl}
                  onChange={(e) => setTranslation({ deepl: e.target.checked })}
                  aria-describedby={`${ids}-deepl-hint`}
                  data-testid="translation-deepl"
                />
                <span>
                  <span className="block text-fg">{t('captionSettings.deepl')}</span>
                  <span id={`${ids}-deepl-hint`} className="block text-sm text-fg-muted">
                    {view.deeplKeyBound ? t('captionSettings.deeplHint') : t('captionSettings.deeplNoKey')}
                  </span>
                </span>
              </label>
              <label className="mt-3 block text-sm font-medium text-fg" htmlFor={`${ids}-deepl-langs`}>{t('captionSettings.deeplLanguages')}</label>
              <input
                id={`${ids}-deepl-langs`}
                className={`${fieldClass} mt-1 w-full sm:w-96`}
                dir="ltr"
                value={deeplLanguages}
                onChange={(e) => setDeeplLanguages(e.target.value)}
                placeholder="en, fr, de"
                aria-describedby={`${ids}-deepl-langs-hint`}
                data-testid="translation-deepl-languages"
              />
              <p id={`${ids}-deepl-langs-hint`} className="text-sm text-fg-muted mt-1">{t('captionSettings.deeplLanguagesHint')}</p>
            </div>
          </section>

          <section className={cardClass} aria-labelledby={`${ids}-inline`}>
            <h2 id={`${ids}-inline`} className="text-lg font-semibold text-fg mb-1">{t('captionSettings.inlineTitle')}</h2>
            <p className="text-sm text-fg-muted mb-4">{t('captionSettings.inlineHint')}</p>
            <label className="flex items-start gap-2 mb-4">
              <input type="checkbox" className={checkbox} checked={form.inline.enabled} onChange={(e) => setInline({ enabled: e.target.checked })} data-testid="inline-enabled" />
              <span className="text-fg">{t('captionSettings.inlineEnabled')}</span>
            </label>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-sm font-medium text-fg" htmlFor={`${ids}-daily`}>{t('captionSettings.dailyItems')}</label>
                <NumberField id={`${ids}-daily`} min={0} max={10000} step={1} className={`${fieldClass} mt-1 w-40`} value={form.inline.dailyItems} onChange={(e) => setInline({ dailyItems: Math.round(Number(e.target.value)) })} data-testid="inline-daily" />
              </div>
              <div>
                <label className="block text-sm font-medium text-fg" htmlFor={`${ids}-inline-budget`}>{t('captionSettings.inlineBudget')}</label>
                <NumberField id={`${ids}-inline-budget`} min={0} max={200} step={1} className={`${fieldClass} mt-1 w-40`} value={form.inline.monthlyBudgetUsd} onChange={(e) => setInline({ monthlyBudgetUsd: Number(parseDigits(e.target.value)) })} data-testid="inline-budget" />
              </div>
            </div>
            <div className="mt-6 border-t border-border pt-4">
              <label className="flex items-start gap-2">
                <input
                  type="checkbox"
                  className={checkbox}
                  checked={form.viewerTitles.enabled}
                  onChange={(e) => setForm((f) => ({ ...f, viewerTitles: { enabled: e.target.checked } }))}
                  aria-describedby={`${ids}-viewer-hint`}
                  data-testid="viewer-titles-enabled"
                />
                <span>
                  <span className="block text-fg">{t('captionSettings.viewerTitles')}</span>
                  <span id={`${ids}-viewer-hint`} className="block text-sm text-fg-muted">{t('captionSettings.viewerTitlesHint')}</span>
                </span>
              </label>
            </div>
          </section>
        </fieldset>

        {canManage ? (
          <button type="submit" className={primaryButtonClass} disabled={busy} data-testid="caption-settings-save">
            {busy ? t('captionSettings.saving') : t('captionSettings.save')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="caption-settings-read-only">{t('captionSettings.readOnly')}</p>
        )}
        {error && <ErrorAlert testId="caption-settings-error">{error}</ErrorAlert>}
        <p role="status" className="text-sm text-fg" data-testid="caption-settings-saved">{notice}</p>
      </form>

      <QuranEditions editions={view.editions} canManage={canManage} />

      <section className={cardClass} aria-labelledby={`${ids}-usage`}>
        <h2 id={`${ids}-usage`} className="text-lg font-semibold text-fg mb-4">{t('captionSettings.usageTitle')}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm" data-testid="translation-usage">
            <thead>
              <tr className="text-start text-fg-muted">
                <th scope="col" className="text-start py-2 pe-4 font-medium">{t('captionSettings.usageKind')}</th>
                <th scope="col" className="text-start py-2 pe-4 font-medium">{t('captionSettings.usageRequests')}</th>
                <th scope="col" className="text-start py-2 pe-4 font-medium">{t('captionSettings.usageTexts')}</th>
                <th scope="col" className="text-start py-2 font-medium">{t('captionSettings.usageCached')}</th>
              </tr>
            </thead>
            <tbody>
              {(['inline', 'viewer', 'caption'] as const).map((kind) => {
                const row = usage(kind);
                return (
                  <tr key={kind} className="border-t border-border">
                    <th scope="row" className="text-start py-2 pe-4 font-normal text-fg">{t(`captionSettings.kind_${kind}`)}</th>
                    <td className="py-2 pe-4 text-fg">{formatNumber(row?.requests ?? 0, locale)}</td>
                    <td className="py-2 pe-4 text-fg">{formatNumber(row?.items ?? 0, locale)}</td>
                    <td className="py-2 text-fg">{formatNumber(row?.cached ?? 0, locale)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <section className={cardClass} aria-labelledby={`${ids}-history`}>
        <h2 id={`${ids}-history`} className="text-lg font-semibold text-fg mb-2">{t('captionSettings.historyTitle')}</h2>
        {view.audit.length === 0 ? (
          <p className="text-sm text-fg-muted">{t('captionSettings.historyEmpty')}</p>
        ) : (
          <ul className="space-y-1 text-sm text-fg-muted" data-testid="caption-settings-history">
            {view.audit.map((a) => (
              <li key={a.id}>{fillNodes(t('captionSettings.historyEntry'), { date: <LocalTime value={a.createdAt} withTime />, actor: <UserName id={a.actorId} showEmail={false} /> })}</li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/** The platform's Quran Foundation edition per language: translated caption tracks show it unless a channel picked its own. */
function QuranEditions({ editions, canManage }: { editions: View['editions']; canManage: boolean }) {
  const { t } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [language, setLanguage] = useState('');
  const [choices, setChoices] = useState<Array<{ id: number; name: string }> | null>(null);
  const [choice, setChoice] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  async function load(lang: string) {
    setError(null);
    setNotice(null);
    setChoices(null);
    setChoice(null);
    if (!LANG.test(lang) || lang === 'ar') {
      setError(t('captionSettings.quranLanguageInvalid'));
      return;
    }
    setBusy(true);
    try {
      const result = await listQuranEditions(lang);
      if (!result.ok) {
        setError(result.status === 409 ? t('captionSettings.quranUnavailable') : t('captionSettings.saveFailed'));
        return;
      }
      setChoices(result.data.editions);
      setChoice(editions.find((e) => e.language === lang)?.id ?? result.data.editions[0]?.id ?? null);
    } finally {
      setBusy(false);
    }
  }

  async function run(action: () => Promise<{ ok: boolean; status?: number }>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const result = await action();
      if (!result.ok) {
        setError(result.status === 409 ? t('captionSettings.quranUnavailable') : t('captionSettings.saveFailed'));
        return;
      }
      setNotice(t('captionSettings.saved'));
      setChoices(null);
      router.refresh();
    } catch (e) {
      logger.error('[caption-settings] Quran edition change failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('captionSettings.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-labelledby={`${ids}-quran`} data-testid="quran-editions">
      <h2 id={`${ids}-quran`} className="text-lg font-semibold text-fg mb-1">{t('captionSettings.quranTitle')}</h2>
      <p className="text-sm text-fg-muted mb-4">{t('captionSettings.quranHint')}</p>
      <ul className="divide-y divide-border mb-4">
        {editions.map((e) => (
          <li key={e.language} className="flex flex-wrap items-center gap-x-4 gap-y-1 py-2" data-testid={`quran-edition-${e.language}`}>
            <span className="font-mono text-fg w-10" dir="ltr">{e.language}</span>
            <span className="text-fg flex-1 min-w-40">{e.name}</span>
            <span className="text-xs text-fg-muted">{t(e.source === 'platform' ? 'captionSettings.quranPlatform' : 'captionSettings.quranDefault')}</span>
            {canManage && e.source === 'platform' && (
              <button type="button" className={`${secondaryButtonClass} !py-1 !px-3 text-sm`} disabled={busy} onClick={() => run(() => resetQuranEdition(e.language))} data-testid={`quran-reset-${e.language}`}>
                {t('captionSettings.quranReset')}
              </button>
            )}
          </li>
        ))}
      </ul>
      {canManage && (
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="block text-sm font-medium text-fg" htmlFor={`${ids}-lang`}>{t('captionSettings.quranLanguage')}</label>
            <input id={`${ids}-lang`} className={`${fieldClass} mt-1 w-28`} dir="ltr" value={language} onChange={(e) => setLanguage(e.target.value.trim().toLowerCase())} placeholder="en" data-testid="quran-language" />
          </div>
          <button type="button" className={secondaryButtonClass} disabled={busy || !language} onClick={() => load(language)} data-testid="quran-load">
            {t('captionSettings.quranLoad')}
          </button>
          {choices && (
            <>
              <div className="min-w-60">
                <label className="block text-sm font-medium text-fg" htmlFor={`${ids}-edition`}>{t('captionSettings.quranEdition')}</label>
                <Select id={`${ids}-edition`} className={`${fieldClass} mt-1 w-full`} value={choice ?? ''} onChange={(e) => setChoice(Number(e.target.value))} data-testid="quran-edition-select">
                  {choices.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </Select>
              </div>
              <button type="button" className={primaryButtonClass} disabled={busy || choice === null} onClick={() => choice !== null && run(() => setQuranEdition(language, choice))} data-testid="quran-save">
                {t('captionSettings.quranSave')}
              </button>
            </>
          )}
        </div>
      )}
      {error && <div className="mt-3"><ErrorAlert testId="quran-error">{error}</ErrorAlert></div>}
      <p role="status" className="text-sm text-fg mt-2">{notice}</p>
    </section>
  );
}
