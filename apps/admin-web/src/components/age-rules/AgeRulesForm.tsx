'use client';

import { useId, useState } from 'react';
import { useRouter } from 'next/navigation';
import { AGE_CHOICES, AGE_RULE_KEYS, sameAgeNumbers, type AgeChoice, type AgeNumbers, type AgeRuleKey } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import type { AgeRulesChange, AgeRulesView } from '@/lib/api/ageRules';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { Select } from '@/components/select/Select';
import { PersonName } from '@/components/audit/Named';
import { personView } from '@/components/audit/audit-model';
import { fillNodes } from '@/components/audit/fill';
import { LocalTime } from '@/components/LocalTime';
import { logger } from '@/lib/logger-client';

const LABELS = {
  comment: 'ageRules.keyComment',
  post: 'ageRules.keyPost',
  liveChat: 'ageRules.keyLiveChat',
  upload: 'ageRules.keyUpload',
  support: 'ageRules.keySupport',
  ageRestricted: 'ageRules.keyAgeRestricted',
} as const satisfies Record<AgeRuleKey, string>;

export function AgeRulesForm({
  view,
  history,
  save: saveNumbers,
}: {
  view: AgeRulesView;
  /** Null: it could not be loaded */
  history: AgeRulesChange[] | null;
  save: (numbers: AgeNumbers, expectedVersion: number) => Promise<ActionResult<{ numbers: AgeNumbers; version: number }>>;
}) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const ids = useId();
  const [numbers, setNumbers] = useState<AgeNumbers>(view.numbers ?? view.suggested);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // admin-api sends the names, so none is looked up again
  const person = (id: string, name: string | null) => <PersonName person={personView(id, name ? { users: { [id]: { id, name, userName: null, email: null, found: true } }, items: {} } : null, t)} showEmail={false} />;
  const andOver = (age: number) => t('ageRules.andOver', { age: formatNumber(age, locale) });
  // Each group ends the year before the next one starts
  const [min, mid, max] = AGE_CHOICES;
  const groups = { min: formatNumber(min, locale), minEnd: formatNumber(mid - 1, locale), mid: formatNumber(mid, locale), midEnd: formatNumber(max - 1, locale), max: formatNumber(max, locale) };
  const unchanged = view.numbers !== null && sameAgeNumbers(view.numbers, numbers);

  /** "Live chat: 16 and over → 18 and over", one per number that changed. */
  const describe = (change: AgeRulesChange) =>
    AGE_RULE_KEYS.filter((key) => change.from?.[key] !== change.to[key])
      .map((key) =>
        change.from
          ? t('ageRules.historyChanged', { name: t(LABELS[key]), from: andOver(change.from[key]), to: andOver(change.to[key]) })
          : t('ageRules.historySet', { name: t(LABELS[key]), to: andOver(change.to[key]) }),
      )
      .join(t('ageRules.historySeparator'));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!view.canEdit || unchanged || busy) return;
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const result = await saveNumbers(numbers, view.version);
      if (!result.ok) {
        logger.warn('[age-rules] Save failed', { status: result.status });
        setError(t(result.status === 401 ? 'errors.notAuthenticated' : result.code === 'age_rules_changed' ? 'ageRules.conflict' : 'ageRules.saveFailed'));
        return;
      }
      setSaved(true);
      router.refresh();
    } catch (e) {
      logger.error('[age-rules] Save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('ageRules.saveFailed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className={cardClass} aria-labelledby={`${ids}-title`} data-testid="age-rules-form" data-version={view.version}>
      <h2 id={`${ids}-title`} className="text-lg font-semibold text-fg mb-1">{t('ageRules.agesTitle')}</h2>
      <p className="text-sm text-fg-muted mb-4">{t('ageRules.agesSubtitle', groups)}</p>
      <form onSubmit={submit} noValidate>
        <ul className="divide-y divide-border">
          {AGE_RULE_KEYS.map((key) => (
            <li key={key} className="flex flex-col gap-2 py-3 sm:flex-row sm:items-center sm:justify-between">
              <span id={`${ids}-${key}`} className="text-sm text-fg font-medium">{t(LABELS[key])}</span>
              <Select
                className={`${fieldClass} w-full sm:w-44`}
                value={String(numbers[key])}
                disabled={!view.canEdit || busy}
                aria-labelledby={`${ids}-${key}`}
                data-testid={`age-rules-${key}`}
                onChange={(e) => {
                  setNumbers({ ...numbers, [key]: Number(e.target.value) as AgeChoice });
                  setError(null);
                  setSaved(false);
                }}
              >
                {AGE_CHOICES.map((age) => (
                  <option key={age} value={String(age)}>{andOver(age)}</option>
                ))}
              </Select>
            </li>
          ))}
        </ul>
        {/* A name can hold a disclosure, so never in a paragraph */}
        <div className="text-sm text-fg-muted mt-4 mb-4" data-testid="age-rules-last-changed">
          {view.updatedAt && view.updatedBy
            ? fillNodes(t('ageRules.lastChanged'), { date: <LocalTime value={view.updatedAt} withTime />, actor: person(view.updatedBy.id, view.updatedBy.name) })
            : t('ageRules.neverSaved')}
        </div>
        {view.canEdit ? (
          <button type="submit" className={`${primaryButtonClass} disabled:opacity-60 disabled:cursor-not-allowed`} disabled={busy || unchanged} data-testid="age-rules-save">
            {t(busy ? 'ageRules.saving' : 'ageRules.save')}
          </button>
        ) : (
          <p className="text-sm text-fg-muted" data-testid="age-rules-read-only">{t('ageRules.readOnly')}</p>
        )}
        {error && <div className="mt-4"><ErrorAlert testId="age-rules-error">{error}</ErrorAlert></div>}
        <p role="status" className="text-sm text-fg mt-2" data-testid="age-rules-saved">{saved ? t('ageRules.saved') : ''}</p>
      </form>
      <h3 className="text-sm font-semibold text-fg mt-6 mb-2">{t('ageRules.historyTitle')}</h3>
      {history === null ? (
        <p className="text-sm text-fg-muted" data-testid="age-rules-history-error">{t('ageRules.historyFailed')}</p>
      ) : history.length === 0 ? (
        <p className="text-sm text-fg-muted">{t('ageRules.historyEmpty')}</p>
      ) : (
        <ul className="space-y-2 text-sm text-fg-muted" data-testid="age-rules-history">
          {history.map((change) => (
            <li key={change.id}>
              {fillNodes(t('ageRules.historyEntry', { changes: describe(change) }), { date: <LocalTime value={change.createdAt} withTime />, actor: person(change.actorId, change.actorName) })}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
