'use client';

import { useId, useState } from 'react';
import Link from '@/components/AppLink';
import { useRouter } from 'next/navigation';
import type { AdminCreatorRow, CreatorTier, CreatorTierBulkResult } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { isUnexpectedFailure, tierActionMessage, tierChangeMessage } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, formatNumber } from '@/i18n/translate';
import { ErrorAlert, fieldClass, linkClass } from '@/components/ui';
import { MonoId, smallButtonClass, tableWrapClass, tdClass, thClass } from '@/components/content/parts';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { CreatorTierControl, type SetTierAction } from './CreatorTierControl';
import { TierChangeDialog } from './TierChangeDialog';

const NONE = '__none__';

/**
 * The Creators list: each videos user with their tier (and where it came
 * from), channels, this hour's and today's uploads against their limits, and
 * limit hits. Rows are selectable for a bulk tier change; super admins are
 * not, since their Unlimited is automatic.
 */
export interface CreatorsTableProps {
  items: AdminCreatorRow[];
  tiers: CreatorTier[];
  canManage: boolean;
  /** Server actions (lib/api/creators), passed down from the page */
  setTier: SetTierAction;
  bulkSetTier: (userIds: string[], tierId: string | null) => Promise<ActionResult<CreatorTierBulkResult>>;
}

export function CreatorsTable({ items, tiers, canManage, setTier, bulkSetTier }: CreatorsTableProps) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const ids = useId();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const selectable = items.filter((row) => row.origin !== 'super_admin');
  const chosen = selectable.filter((row) => selected.has(row.userId));
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;
  const tierById = new Map(tiers.map((tier) => [tier.id, tier]));
  const bulkTarget = bulkTier === NONE ? null : tierById.get(bulkTier) ?? null;
  const n = (value: number) => formatNumber(value, locale);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function applyBulk() {
    setConfirming(false);
    setBusy(true);
    setError(null);
    setNotice(null);
    let result: ActionResult<CreatorTierBulkResult>;
    try {
      result = await bulkSetTier(chosen.map((row) => row.userId), bulkTier === NONE ? null : bulkTier);
    } catch (e) {
      result = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
    setBusy(false);
    if (!result.ok) {
      logger.warn('[creators] Bulk tier change failed', { status: result.status, code: result.code, users: chosen.length });
      if (isUnexpectedFailure(result)) reportError(new Error(`Bulk creator tier change failed: ${result.status} ${result.code ?? ''}`.trim()), { kind: 'fetch', status: result.status, shown: true });
      setError(t(tierActionMessage(result)));
      return;
    }
    const parts = [t('creators.bulkChanged', { count: n(result.data.changed.length) })];
    if (result.data.unchanged.length) parts.push(t('creators.bulkUnchanged', { count: n(result.data.unchanged.length) }));
    if (result.data.skippedSuperAdmin.length) parts.push(t('creators.bulkSkipped', { count: n(result.data.skippedSuperAdmin.length) }));
    setNotice(parts.join(' '));
    setSelected(new Set());
    setBulkTier('');
    router.refresh();
  }

  return (
    <div className="space-y-3">
      {canManage && (
        <div className="flex flex-wrap items-end gap-3" role="toolbar" aria-label={t('creators.bulkLabel')} data-testid="creators-bulk">
          <span className="text-sm text-fg-muted tabular-nums self-center" aria-live="polite" data-testid="creators-selected">
            {t('creators.selected', { count: n(chosen.length) })}
          </span>
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            {t('creators.bulkTier')}
            <select value={bulkTier} onChange={(e) => setBulkTier(e.target.value)} className={`${fieldClass} py-1 text-sm`} data-testid="creators-bulk-tier">
              <option value="">{t('creators.bulkChoose')}</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>{tier.name}</option>
              ))}
              <option value={NONE}>{t('creators.noTier')}</option>
            </select>
          </label>
          <button
            type="button"
            className={smallButtonClass}
            disabled={!chosen.length || !bulkTier || busy}
            onClick={() => setConfirming(true)}
            data-testid="creators-bulk-apply"
          >
            {busy ? t('creators.saving') : t('creators.bulkApply')}
          </button>
        </div>
      )}
      {error && <ErrorAlert testId="creators-bulk-error">{error}</ErrorAlert>}
      {notice && <p role="status" className="text-success-fg text-sm" data-testid="creators-bulk-notice">{notice}</p>}

      <div className={tableWrapClass}>
        <table className="w-full" data-testid="creators-table">
          <caption className="sr-only">{t('creators.tableCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              {canManage && (
                <th scope="col" className={thClass}>
                  <input
                    type="checkbox"
                    id={`${ids}-all`}
                    aria-label={t('creators.selectAll')}
                    checked={allSelected}
                    disabled={!selectable.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((row) => row.userId)))}
                    className="h-4 w-4 accent-accent"
                    data-testid="creators-select-all"
                  />
                </th>
              )}
              <th scope="col" className={thClass}>{t('creators.colUser')}</th>
              <th scope="col" className={thClass}>{t('creators.colTier')}</th>
              <th scope="col" className={thClass}>{t('creators.colChannels')}</th>
              <th scope="col" className={thClass}>{t('creators.colUsage')}</th>
              <th scope="col" className={thClass}>{t('creators.colHits')}</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 && (
              <tr>
                <td colSpan={canManage ? 6 : 5} className={`${tdClass} text-fg-muted text-center`} data-testid="creators-empty">{t('creators.empty')}</td>
              </tr>
            )}
            {items.map((row) => {
              const name = row.displayName || row.userName || row.userId;
              const tier = row.assignment ? tierById.get(row.assignment.tierId) ?? null : null;
              const limited = tier && !tier.unlimited ? tier : null;
              return (
                <tr key={row.userId} className="border-b border-border last:border-0" data-testid="creator-row" data-user-id={row.userId} data-needs-tier={row.needsTier ? 'true' : 'false'}>
                  {canManage && (
                    <td className={tdClass}>
                      <input
                        type="checkbox"
                        aria-label={t('creators.selectUser', { name })}
                        checked={selected.has(row.userId)}
                        disabled={row.origin === 'super_admin'}
                        title={row.origin === 'super_admin' ? t('creators.superAdminLocked') : undefined}
                        onChange={() => toggle(row.userId)}
                        className="h-4 w-4 accent-accent"
                        data-testid="creator-select"
                      />
                    </td>
                  )}
                  <td className={`${tdClass} text-sm`}>
                    <Link href={`/users/${encodeURIComponent(row.userId)}`} className={`${linkClass} font-medium`} dir="auto">{name}</Link>
                    {row.userName && <div className="text-fg-muted" dir="ltr">@{row.userName}</div>}
                    {row.email && <div className="text-fg-muted break-all" dir="ltr">{row.email}</div>}
                    <MonoId value={row.userId} />
                  </td>
                  <td className={`${tdClass} text-sm`}>
                    <CreatorTierControl
                      userId={row.userId}
                      userName={name}
                      current={row.assignment && row.origin ? { ...row.assignment, origin: row.origin, assignedByName: row.assignedByName } : null}
                      tiers={tiers}
                      canManage={canManage}
                      needsTier={row.needsTier}
                      setTier={setTier}
                    />
                  </td>
                  <td className={`${tdClass} text-sm tabular-nums`}>
                    {n(row.channels)}
                    {tier && <span className="text-fg-muted"> / {tier.unlimited || tier.maxChannels === null ? '∞' : n(tier.maxChannels)}</span>}
                  </td>
                  <td className={`${tdClass} text-sm tabular-nums`} data-testid="creator-usage">
                    <div>{limited ? t('creators.usageHourOf', { count: n(row.usage.hour), limit: n(limited.perHour) }) : t('creators.usageHour', { count: n(row.usage.hour) })}</div>
                    <div className="text-fg-muted">{limited ? t('creators.usageDayOf', { count: n(row.usage.day), limit: n(limited.perDay) }) : t('creators.usageDay', { count: n(row.usage.day) })}</div>
                  </td>
                  <td className={`${tdClass} text-sm`}>
                    <span className={row.limitHits7d > 0 ? 'font-semibold text-warning-fg tabular-nums' : 'tabular-nums'}>{n(row.limitHits7d)}</span>
                    {row.lastLimitHitAt && <div className="text-xs text-fg-muted">{t('creators.lastHit', { date: formatDate(row.lastLimitHitAt, locale, true) })}</div>}
                    {row.limitHits7d > 0 && limited && (
                      <Link href={`/creators/tiers#tier-${encodeURIComponent(limited.id)}`} className={`${linkClass} text-xs`} data-testid="creator-raise-limit">
                        {t('creators.raiseLimit', { tier: limited.name })}
                      </Link>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <TierChangeDialog
        open={confirming}
        title={bulkTier === NONE ? t('creators.confirmRemoveTitle') : t('creators.confirmAssignTitle')}
        body={tierChangeMessage(bulkTarget, t, locale, { count: chosen.length })}
        warning={bulkTier === NONE ? t('creators.removeWarning') : null}
        confirmLabel={bulkTier === NONE ? t('creators.removeTier') : t('creators.assignTier', { tier: bulkTarget?.name ?? '' })}
        danger={bulkTier === NONE}
        testId="creators-bulk-change"
        onCancel={() => setConfirming(false)}
        onConfirm={() => void applyBulk()}
      />
    </div>
  );
}
