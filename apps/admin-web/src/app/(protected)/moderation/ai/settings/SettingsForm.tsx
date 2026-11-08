'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { LLAMA_GUARD_CATEGORIES, MODERATION_EXTENSION_CATEGORIES, AI_HIDEABLE_CATEGORIES, type ModerationCategoryPolicy } from '@al-ummah/shared-types';
import { updateAiConfig } from '@/lib/api/admin';
import type { AiConfigView } from '@/lib/api/types';
import { useLanguage } from '@/i18n/I18nProvider';
import { translateDynamic } from '@/i18n/translate';
import { ErrorAlert, cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import { logger } from '@/lib/logger-client';

const CATEGORIES = [...Object.keys(LLAMA_GUARD_CATEGORIES), ...MODERATION_EXTENSION_CATEGORIES];
type Policy = Partial<ModerationCategoryPolicy>;

export function SettingsForm({ initial }: { initial: AiConfigView }) {
  const router = useRouter();
  const { t } = useLanguage();
  const readOnly = !initial.canEdit;
  const [enabled, setEnabled] = useState(initial.enabled);
  const [cap, setCap] = useState(String(initial.dailyNeuronCap ?? ''));
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
    const capNumber = Number(cap);
    try {
      const result = await updateAiConfig({
        enabled,
        extensionsEnabled: extensions,
        ...(cap !== '' && Number.isFinite(capNumber) ? { dailyNeuronCap: Math.round(capNumber) } : {}),
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
          <input type="number" min={0} max={10000000} step={1000} value={cap} disabled={readOnly} onChange={(e) => { setCap(e.target.value); setSaved(false); }} className={`${fieldClass} mt-1 w-48`} dir="ltr" data-testid="ai-cap" />
          <span className="block text-sm text-fg-muted mt-1">{t('ai.dailyCapHint')}</span>
        </label>
      </section>

      <section className={cardClass}>
        <h2 className="font-semibold text-fg mb-1">{t('ai.policiesTitle')}</h2>
        <p className="text-sm text-fg-muted mb-4">{t('ai.enforceWarning')}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr>
                <th scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colCategory')}</th>
                <th scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colEnabled')}</th>
                <th scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colMode')}</th>
                <th scope="col" className="text-start py-2 pe-4 text-fg-muted">{t('ai.colThreshold')}</th>
                <th scope="col" className="text-start py-2 text-fg-muted">{t('ai.colAction')}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {CATEGORIES.map((category) => {
                const p = policies[category] ?? {};
                const canHide = (AI_HIDEABLE_CATEGORIES as readonly string[]).includes(category);
                const label = translateDynamic(t, 'aiCategory', category);
                return (
                  <tr key={category} data-testid="ai-policy-row" data-category={category}>
                    <td className="py-2 pe-4 text-fg">{label}</td>
                    <td className="py-2 pe-4">
                      <input type="checkbox" aria-label={`${label}: ${t('ai.colEnabled')}`} checked={p.enabled ?? category !== 'religious_authenticity'} disabled={readOnly} onChange={(e) => setPolicy(category, { enabled: e.target.checked })} />
                    </td>
                    <td className="py-2 pe-4">
                      <select aria-label={`${label}: ${t('ai.colMode')}`} value={p.mode ?? 'shadow'} disabled={readOnly} onChange={(e) => setPolicy(category, { mode: e.target.value as 'shadow' | 'enforce' })} className={fieldClass}>
                        <option value="shadow">{t('aiMode.shadow')}</option>
                        <option value="enforce">{t('aiMode.enforce')}</option>
                      </select>
                    </td>
                    <td className="py-2 pe-4">
                      <input type="number" aria-label={`${label}: ${t('ai.colThreshold')}`} min={0} max={1} step={0.05} value={p.threshold ?? ''} placeholder="—" disabled={readOnly} onChange={(e) => setPolicy(category, { threshold: Number(e.target.value) })} className={`${fieldClass} w-24`} dir="ltr" />
                    </td>
                    <td className="py-2">
                      <select aria-label={`${label}: ${t('ai.colAction')}`} value={p.action ?? (canHide ? 'hide' : 'flag')} disabled={readOnly} onChange={(e) => setPolicy(category, { action: e.target.value as 'none' | 'flag' | 'hide' })} className={fieldClass}>
                        <option value="none">{t('aiAction.none')}</option>
                        <option value="flag">{t('aiAction.flag')}</option>
                        {canHide && <option value="hide">{t('aiAction.hide')}</option>}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
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
