'use client';

import { useState } from 'react';
import { KIDS_DECISION_IDS, KIDS_TURN_ON_REASONS } from '@al-ummah/shared-types';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatNumber } from '@/i18n/translate';
import { Autocomplete } from '@/components/search/Autocomplete';
import { Chip } from '@/components/content/parts';
import { cardClass, fieldClass, primaryButtonClass } from '@/components/ui';
import type { KidsAdminActions, KidsPolicyResponse, KidsStaffChannelSummary } from '@/lib/api/kids-types';

type GuardedFn = (key: string, fn: () => Promise<{ ok: boolean; status?: number; error?: string; code?: string }>) => Promise<boolean>;

export function KidsPolicyTab({
  initial,
  actions,
  busy,
  guarded,
}: {
  initial: KidsPolicyResponse;
  actions: KidsAdminActions;
  busy: string | null;
  guarded: GuardedFn;
}) {
  const { t, locale } = useLanguage();
  const [baselineDecisions, setBaselineDecisions] = useState<Record<string, string>>(initial.decisions);
  const [decisions, setDecisions] = useState<Record<string, string>>(initial.decisions);
  const [baselineStaffChannelIds, setBaselineStaffChannelIds] = useState<string[]>(() => initial.staffChannelIds ?? []);
  const [staffChannels, setStaffChannels] = useState<KidsStaffChannelSummary[]>(() => {
    if (initial.staffChannels && initial.staffChannels.length > 0) return initial.staffChannels;
    return (initial.staffChannelIds ?? []).map((id) => ({ id, name: null }));
  });
  const [channelPickerKey, setChannelPickerKey] = useState(0);
  const [baselineLegalApproved, setBaselineLegalApproved] = useState(initial.legalApproved);
  const [legalApproved, setLegalApproved] = useState(initial.legalApproved);
  const [legalApprovedBy, setLegalApprovedBy] = useState(initial.legalApprovedBy);
  const [legalApprovedByName, setLegalApprovedByName] = useState(initial.legalApprovedByName ?? null);
  const [policyUpdatedAt, setPolicyUpdatedAt] = useState<string | null>(initial.updatedAt ?? null);
  const [readiness, setReadiness] = useState(initial.readiness);
  const [savedNotice, setSavedNotice] = useState(false);

  const recordedCount = KIDS_DECISION_IDS.filter((id) => Boolean(decisions[id]?.trim())).length;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSavedNotice(false);
    await guarded('policy:save', async () => {
      const changedDecisions: Record<string, string | null> = {};
      for (const id of KIDS_DECISION_IDS) {
        const nextVal = decisions[id]?.trim() ?? '';
        const prevVal = baselineDecisions[id]?.trim() ?? '';
        if (nextVal !== prevVal) {
          changedDecisions[id] = nextVal || null;
        }
      }
      const nextChannelIds = staffChannels.map((ch) => ch.id);
      const staffChannelsChanged =
        nextChannelIds.length !== baselineStaffChannelIds.length ||
        nextChannelIds.some((id, idx) => baselineStaffChannelIds[idx] !== id);
      const legalApprovedChanged = legalApproved !== baselineLegalApproved;

      const res = await actions.updatePolicy({
        ...(Object.keys(changedDecisions).length > 0 ? { decisions: changedDecisions } : {}),
        ...(staffChannelsChanged ? { staffChannelIds: nextChannelIds } : {}),
        ...(legalApprovedChanged ? { legalApproved } : {}),
        expectedUpdatedAt: policyUpdatedAt,
      });
      if (res.ok) {
        setBaselineDecisions(res.data.decisions);
        setDecisions(res.data.decisions);
        setBaselineStaffChannelIds(res.data.staffChannelIds ?? []);
        setStaffChannels(
          res.data.staffChannels ?? res.data.staffChannelIds.map((id) => ({ id, name: null })),
        );
        setBaselineLegalApproved(res.data.legalApproved);
        setLegalApproved(res.data.legalApproved);
        setLegalApprovedBy(res.data.legalApprovedBy);
        setLegalApprovedByName(res.data.legalApprovedByName ?? null);
        setPolicyUpdatedAt(res.data.updatedAt ?? null);
        setReadiness(res.data.readiness);
        setSavedNotice(true);
      }
      return res;
    });
  }

  return (
    <div className="space-y-6">
      <section className={`${cardClass} space-y-3`} data-testid="kids-policy-readiness">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">{t('kids.policy.readinessHeading')}</h2>
          <Chip tone={readiness.ready ? 'good' : 'warn'}>
            {readiness.ready ? t('kids.policy.ready') : t('kids.policy.notReady')}
          </Chip>
        </div>
        {readiness.blockers.length > 0 && (
          <ul className="space-y-2 text-sm">
            {readiness.blockers.map((blocker) => {
              const reason = KIDS_TURN_ON_REASONS[blocker];
              return (
                <li key={blocker} className="flex items-start gap-2" data-testid={`kids-readiness-blocker-${blocker}`}>
                  <Chip tone="bad">!</Chip>
                  <span className="text-fg">{locale === 'ar' ? reason.ar : reason.en}</span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <form onSubmit={handleSave} className={`${cardClass} space-y-4`} data-testid="kids-policy-form">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold text-fg">
            {t('kids.policy.decisionsHeading', {
              done: formatNumber(recordedCount, locale),
              total: formatNumber(KIDS_DECISION_IDS.length, locale),
            })}
          </h2>
          {!initial.canEdit && <span className="text-xs text-fg-muted">{t('kids.policy.superAdminHint')}</span>}
        </div>

        <label className="flex items-start gap-2 text-sm text-fg cursor-pointer">
          <input
            type="checkbox"
            checked={legalApproved}
            disabled={!initial.canEdit || !!busy}
            onChange={(e) => setLegalApproved(e.target.checked)}
            className="mt-0.5 size-4 accent-accent"
            data-testid="kids-policy-legal-approved"
          />
          <div>
            <span>{t('kids.policy.legalApprovedLabel')}</span>
            {legalApprovedBy && (
              <div className="text-xs text-fg-muted mt-0.5">
                {t('kids.policy.legalSignedBy', { actor: legalApprovedByName?.trim() || legalApprovedBy })}
              </div>
            )}
          </div>
        </label>

        <div className="space-y-2 pt-2 border-t border-border" data-testid="kids-policy-staff-channels">
          <div className="text-sm font-medium text-fg">{t('kids.policy.staffChannelsLabel')}</div>
          <p className="text-xs text-fg-muted">{t('kids.policy.staffChannelsHint')}</p>
          {staffChannels.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {staffChannels.map((ch) => (
                <span
                  key={ch.id}
                  className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full border border-border bg-surface-2 text-sm text-fg"
                  data-testid={`kids-staff-channel-${ch.id}`}
                >
                  <bdi dir="auto">{ch.name?.trim() || ch.id}</bdi>
                  {initial.canEdit && (
                    <button
                      type="button"
                      disabled={!!busy}
                      onClick={() => setStaffChannels((prev) => prev.filter((item) => item.id !== ch.id))}
                      aria-label={t('kids.policy.staffChannelsRemove', { channel: ch.name?.trim() || ch.id })}
                      className="text-xs text-fg-muted hover:text-fg"
                    >
                      ×
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}
          {initial.canEdit && (
            <div className="max-w-md">
              <Autocomplete
                key={channelPickerKey}
                kind="channel"
                mode="pick"
                label={t('kids.policy.staffChannelsAdd')}
                placeholder={t('kids.catalog.pickPlaceholder')}
                hint={t('kids.catalog.pickHint')}
                testId="kids-policy-channel-picker"
                onChange={(id, item) => {
                  if (!id) return;
                  setStaffChannels((prev) =>
                    prev.some((x) => x.id === id) ? prev : [...prev, { id, name: item?.label ?? null }],
                  );
                  setChannelPickerKey((k) => k + 1);
                }}
              />
            </div>
          )}
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {KIDS_DECISION_IDS.map((id) => (
            <label key={id} className="flex flex-col gap-1 text-sm">
              <span className="font-medium text-fg">
                {t(`kids.policy.decisions.${id}.label` as Parameters<typeof t>[0])}
              </span>
              <span className="text-xs text-fg-muted">
                {t(`kids.policy.decisions.${id}.description` as Parameters<typeof t>[0])}
              </span>
              <input
                type="text"
                value={decisions[id] ?? ''}
                disabled={!initial.canEdit || !!busy}
                onChange={(e) => setDecisions((prev) => ({ ...prev, [id]: e.target.value }))}
                placeholder={t('kids.policy.decisionPlaceholder')}
                className={fieldClass}
                dir="auto"
                data-testid={`kids-decision-${id}`}
              />
            </label>
          ))}
        </div>

        {initial.canEdit && (
          <div className="flex items-center gap-3">
            <button type="submit" disabled={!!busy} className={primaryButtonClass} data-testid="kids-policy-save">
              {busy === 'policy:save' ? t('kids.policy.saving') : t('kids.policy.save')}
            </button>
            {savedNotice && <span className="text-sm text-success-fg" data-testid="kids-policy-saved">{t('kids.policy.saved')}</span>}
          </div>
        )}
      </form>
    </div>
  );
}
