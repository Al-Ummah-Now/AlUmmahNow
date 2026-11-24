'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { AI_HIDEABLE_CATEGORIES, LLAMA_GUARD_CATEGORIES, MODERATION_EXTENSION_CATEGORIES, DEFAULT_LIVE_CHAT_SHARE, parseDigits, type ModerationCategoryPolicy } from '@al-ummah/shared-types';
import { updateAiConfig } from '@/lib/api/admin';
import type { AiConfigView } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';
import { NumberField } from '@/components/forms/NumberField';
import { Select } from '@/components/select/Select';

const CATEGORIES = [...Object.keys(LLAMA_GUARD_CATEGORIES), ...MODERATION_EXTENSION_CATEGORIES];
type Policy = Partial<ModerationCategoryPolicy>;

export function SettingsForm({ initial }: { initial: AiConfigView }) {
  const router = useRouter();
  const { t } = useLanguage();
  const readOnly = !initial.canEdit;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [cap, setCap] = useState(String(initial.dailyNeuronCap ?? ''));
  const [share, setShare] = useState(String(Math.round((initial.liveChatShare ?? DEFAULT_LIVE_CHAT_SHARE) * 100)));
  const [extensions, setExtensions] = useState(initial.extensionsEnabled);
  const [policies, setPolicies] = useState<Record<string, Policy>>(initial.policies as Record<string, Policy>);
  const [changed, setChanged] = useState<Record<string, Policy>>({});
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const setPolicy = (category: string, patch: Policy) => {
    setPolicies((p) => ({ ...p, [category]: { ...p[category], ...patch } }));
    setChanged((c) => ({ ...c, [category]: { ...c[category], ...patch } }));
    setSaved(false);
  };

  async function save() {
    setBusy(true);
    setError(null);
    setSaved(false);
    const capNumber = Number(parseDigits(cap));
    const shareNumber = Number(parseDigits(share));
    try {
      const result = await updateAiConfig({
        enabled,
        extensionsEnabled: extensions,
        ...(cap !== '' && Number.isFinite(capNumber) ? { dailyNeuronCap: Math.round(capNumber) } : {}),
        ...(share !== '' && Number.isFinite(shareNumber) ? { liveChatShare: Math.round(shareNumber) / 100 } : {}),
        ...(Object.keys(changed).length ? { policies: changed } : {}),
      });
      if (!result.ok) {
        logger.warn('[ai-moderation] Config save failed', { status: result.status });
        setError(result.status === 400 ? result.error : t('ai.actionFailed'));
        return;
      }
      setChanged({});
      setSaved(true);
      router.refresh();
    } catch (e) {
      logger.error('[ai-moderation] Config save request failed', { error: e instanceof Error ? e.message : String(e) });
      setError(t('ai.actionFailed'));
    } finally {
      setBusy(false);
    }
  }

  const toggle = (id: string, label: string, hint: string, value: boolean, onChange: (v: boolean) => void) => (
    <label htmlFor={id} className="flex items-start gap-3">
      <input id={id} type="checkbox" checked={value} disabled={readOnly} onChange={(e) => { onChange(e.target.checked); setSaved(false); }} className="mt-1 h-4 w-4" data-testid={id} />
      <span>
        <span className="block font-medium text-fg">{label}</span>
        <span className="block text-sm text-fg-muted">{hint}</span>
      </span>
    </label>
  );

  return (
    <div className="space-y-6">
      {readOnly && <p className="text-fg-muted" data-testid="ai-config-readonly">{t('ai.readOnly')}</p>}
      {error && <ErrorAlert testId="ai-config-save-error">{error}</ErrorAlert>}

      <section className={`${cardClass} space-y-4`}>
        {toggle('ai-enabled-toggle', t('ai.killSwitch'), t('ai.killSwitchHint'), enabled, setEnabled)}
        {toggle('ai-extensions-toggle', t('ai.extensions'), t('ai.extensionsHint'), extensions, setExtensions)}
        <label className="block">
          <span className="block font-medium text-fg">{t('ai.dailyCap')}</span>
          <NumberField min={0} max={10000000} step={1000} value={cap} disabled={readOnly} onChange={(e) => { setCap(e.target.value); setSaved(false); }} className={`${fieldClass} mt-1 w-48`} dir="ltr" data-testid="ai-cap" />
          <span className="block text-sm text-fg-muted mt-1">{t('ai.dailyCapHint')}</span>
        </label>
        <label className="block">
          <span className="block font-medium text-fg">{t('ai.liveChatShare')}</span>
          <NumberField min={0} max={100} step={5} value={share} disabled={readOnly} onChange={(e) => { setShare(e.target.value); setSaved(false); }} className={`${fieldClass} mt-1 w-48`} dir="ltr" data-testid="ai-live-chat-share" />
          <span className="block text-sm text-fg-muted mt-1">{t('ai.liveChatShareHint')}</span>
        </label>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-fg mb-1">{t('ai.policiesTitle')}</h2>
        <p className="text-sm text-fg-muted mb-4">{t('ai.enforceWarning')}</p>
        {/* A table from xl; below it each category is its own block, so no control is cut or scrolled away.
            The roles are written out because a table laid out as blocks loses them in some browsers. */}
        <table role="table" className="block w-full text-sm xl:table">
          <thead role="rowgroup" className="sr-only xl:not-sr-only xl:table-header-group">
            <tr role="row">
              <th role="columnheader" scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colCategory')}</th>
              <th role="columnheader" scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colEnabled')}</th>
              <th role="columnheader" scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colMode')}</th>
              <th role="columnheader" scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colThreshold')}</th>
              <th role="columnheader" scope="col" className="text-start py-2 text-fg-muted">{t('ai.colAction')}</th>
            </tr>
          </thead>
          <tbody role="rowgroup" className="block divide-y divide-border xl:table-row-group">
            {CATEGORIES.map((category) => {
              const p = policies[category] ?? {};
              const canHide = (AI_HIDEABLE_CATEGORIES as readonly string[]).includes(category);
              const label = translateDynamic(t, 'aiCategory', category);
              // Beside its control below xl, where the header row is not shown
              const small = (text: string) => <span aria-hidden="true" className="mb-1 block text-xs text-fg-muted xl:hidden">{text}</span>;
              return (
                <tr role="row" key={category} className="grid grid-cols-2 gap-x-4 gap-y-2 py-3 xl:table-row" data-testid="ai-policy-row" data-category={category}>
                  <td role="cell" className="font-medium text-fg xl:py-2 xl:pe-4 xl:font-normal">{label}</td>
                  <td role="cell" className="xl:py-2 xl:pe-4">
                    <span className="flex items-center justify-end gap-2 xl:justify-start">
                      <span aria-hidden="true" className="text-xs text-fg-muted xl:hidden">{t('ai.colEnabled')}</span>
                      <input type="checkbox" aria-label={`${label}: ${t('ai.colEnabled')}`} checked={p.enabled ?? category !== 'religious_authenticity'} disabled={readOnly} onChange={(e) => setPolicy(category, { enabled: e.target.checked })} />
                    </span>
                  </td>
                  <td role="cell" className="xl:py-2 xl:pe-4">
                    {small(t('ai.colMode'))}
                    <Select aria-label={`${label}: ${t('ai.colMode')}`} value={p.mode ?? 'shadow'} disabled={readOnly} onChange={(e) => setPolicy(category, { mode: e.target.value as 'shadow' | 'enforce' })} className={`${fieldClass} w-full min-w-32`}>
                      <option value="shadow">{t('aiMode.shadow')}</option>
                      <option value="enforce">{t('aiMode.enforce')}</option>
                    </Select>
                  </td>
                  <td role="cell" className="xl:py-2 xl:pe-4">
                    {small(t('ai.colThreshold'))}
                    <NumberField aria-label={`${label}: ${t('ai.colThreshold')}`} min={0} max={1} step={0.05} value={p.threshold ?? ''} placeholder="—" disabled={readOnly} onChange={(e) => setPolicy(category, { threshold: Number(e.target.value) })} className={`${fieldClass} w-full xl:w-24`} dir="ltr" />
                  </td>
                  <td role="cell" className="col-span-2 xl:py-2">
                    {small(t('ai.colAction'))}
                    <Select aria-label={`${label}: ${t('ai.colAction')}`} value={p.action ?? (canHide ? 'hide' : 'flag')} disabled={readOnly} onChange={(e) => setPolicy(category, { action: e.target.value as 'none' | 'flag' | 'hide' })} className={`${fieldClass} w-full min-w-32`}>
                      <option value="none">{t('aiAction.none')}</option>
                      <option value="flag">{t('aiAction.flag')}</option>
                      {canHide && <option value="hide">{t('aiAction.hide')}</option>}
                    </Select>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </section>

      {!readOnly && (
        <div className="flex items-center gap-4">
          <button type="button" onClick={save} disabled={busy} aria-busy={busy} className={primaryButtonClass} data-testid="ai-config-save">
            {busy ? t('ai.working') : t('ai.save')}
          </button>
          {saved && <span role="status" className="text-fg-muted" data-testid="ai-config-saved">{t('ai.saved')}</span>}
        </div>
      )}
    </div>
  );
}
