'use client';

import { useState } from 'react';
import Link from '@/components/AppLink';
import { useRouter } from 'next/navigation';
import type { AdminUserRow, CreatorTier, CreatorTierBulkResult } from '@al-ummah/shared-types';
import type { ActionResult } from '@/lib/api/errors';
import { isUnexpectedFailure, tierActionMessage, tierChangeMessage, tiersHref, tierLabel } from '@/lib/creator-tiers';
import { useLanguage } from '@/i18n/I18nProvider';
import { formatDate, formatNumber, type Translator } from '@/i18n/translate';
import { ErrorAlert, fieldClass, linkClass } from '@/components/ui';
import { Chip, smallButtonClass, tableWrapClass, tdClass, thClass, wideOnly } from '@/components/content/parts';
import { InviteStatusChip } from '@/components/invites/InviteStatusChip';
import { CreatorTierControl, type SetTierAction } from '@/components/creators/CreatorTierControl';
import { TierChangeDialog } from '@/components/creators/TierChangeDialog';
import { logger } from '@/lib/logger-client';
import { reportError } from '@/lib/errors/reporter';
import { adminUserName } from '@/lib/user-name';
import { Select } from '@/components/select/Select';


/** Banned / active, profile deleted, and the invite's status when not signed in yet. */
function StatusChips({ user, t }: { user: AdminUserRow; t: Translator }) {
  return (
    <div className="flex flex-wrap gap-1">
      {user.isBanned ? <Chip tone="bad" testId="chip-banned">{t('users.banned')}</Chip> : <span className="text-fg-subtle text-sm">{t('users.active')}</span>}
      {user.profileDeleted && <Chip tone="neutral">{t('users.profileDeleted')}</Chip>}
      {user.invite && user.invite.status !== 'active' && <InviteStatusChip status={user.invite.status} t={t} />}
    </div>
  );
}

export type BulkSetTierAction = (userIds: string[], tierId: string | null) => Promise<ActionResult<CreatorTierBulkResult>>;

export interface UsersTableProps {
  items: AdminUserRow[];
  /** The tier definitions; null when they could not be loaded (the tier column is then read-only text) */
  tiers: CreatorTier[] | null;
  /** creators:manage: change tiers, one row or the selected rows */
  canManage: boolean;
  /** Server actions (lib/api/creators), passed down from the page */
  setTier: SetTierAction;
  bulkSetTier: BulkSetTierAction;
}

/**
 * The Users list: each videos user with their status, their creator tier
 * (where it came from, changed in place) and this week's upload-limit hits,
 * which link to that tier on the Tiers page. With creators:manage, rows are
 * selectable for a bulk tier change; super admins are not, since their
 * Unlimited is automatic. Every change is confirmed with its effect.
 */
export function UsersTable({ items, tiers, canManage, setTier, bulkSetTier }: UsersTableProps) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkTier, setBulkTier] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const bulk = canManage && tiers !== null;
  const selectable = items.filter((u) => u.creator?.origin !== 'super_admin');
  const chosen = selectable.filter((u) => selected.has(u.id));
  const allSelected = selectable.length > 0 && chosen.length === selectable.length;
  const tierById = new Map((tiers ?? []).map((tier) => [tier.id, tier]));
  const bulkTarget = tierById.get(bulkTier) ?? null;
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
      result = await bulkSetTier(chosen.map((u) => u.id), bulkTier);
    } catch (e) {
      result = { ok: false, status: 0, error: e instanceof Error ? e.message : String(e) };
    }
    setBusy(false);
    if (!result.ok) {
      logger.warn('[users] Bulk tier change failed', { status: result.status, code: result.code, users: chosen.length });
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
      {bulk && (
        <div className="flex flex-wrap items-end gap-3" role="toolbar" aria-label={t('creators.bulkLabel')} data-testid="users-bulk">
          <span className="text-sm text-fg-muted tabular-nums self-center" aria-live="polite" data-testid="users-selected">
            {t('creators.selected', { count: n(chosen.length) })}
          </span>
          <label className="flex flex-col gap-1 text-sm text-fg-muted">
            {t('creators.bulkTier')}
            <Select value={bulkTier} onChange={(e) => setBulkTier(e.target.value)} className={`${fieldClass} py-1 text-sm`} data-testid="users-bulk-tier">
              <option value="">{t('creators.bulkChoose')}</option>
              {tiers.map((tier) => (
                <option key={tier.id} value={tier.id}>{tierLabel(tier, locale)}</option>
              ))}
            </Select>
          </label>
          <button
            type="button"
            className={smallButtonClass}
            disabled={!chosen.length || !bulkTier || busy}
            onClick={() => setConfirming(true)}
            data-testid="users-bulk-apply"
          >
            {busy ? t('creators.saving') : t('creators.bulkApply')}
          </button>
        </div>
      )}
      {error && <ErrorAlert testId="users-bulk-error">{error}</ErrorAlert>}
      {notice && <p role="status" className="text-success-fg text-sm" data-testid="users-bulk-notice">{notice}</p>}

      <div className={tableWrapClass}>
        <table className="w-full" data-testid="users-table">
          <caption className="sr-only">{t('users.tableCaption')}</caption>
          <thead className="border-b border-border">
            <tr>
              {bulk && (
                <th scope="col" className={`${thClass} w-10`}>
                  <input
                    type="checkbox"
                    aria-label={t('creators.selectAll')}
                    checked={allSelected}
                    disabled={!selectable.length}
                    onChange={() => setSelected(allSelected ? new Set() : new Set(selectable.map((u) => u.id)))}
                    className="h-4 w-4 accent-accent"
                    data-testid="users-select-all"
                  />
                </th>
              )}
              <th className={thClass} scope="col">{t('users.colUser')}</th>
              <th className={`${thClass} ${wideOnly}`} scope="col">{t('users.colEmail')}</th>
              <th className={`${thClass} ${wideOnly}`} scope="col">{t('users.colStatus')}</th>
              <th className={thClass} scope="col">{t('creators.colTier')}</th>
              <th className={`${thClass} ${wideOnly}`} scope="col">{t('users.colCreated')}</th>
            </tr>
          </thead>
          <tbody>
            {items.map((u) => {
              const name = adminUserName(u, t('auditLog.unknownUser'));
              const creator = u.creator;
              const tier = creator?.assignment ? tierById.get(creator.assignment.tierId) ?? null : null;
              const limited = tier && !tier.unlimited ? tier : null;
              return (
                <tr
                  key={u.id}
                  className="border-b border-border last:border-0 hover:bg-surface-hover align-top"
                  data-testid="user-row"
                  data-user-id={u.id}
                  data-needs-tier={creator?.needsTier ? 'true' : 'false'}
                >
                  {bulk && (
                    <td className={tdClass}>
                      <input
                        type="checkbox"
                        aria-label={t('creators.selectUser', { name })}
                        checked={selected.has(u.id)}
                        disabled={creator?.origin === 'super_admin'}
                        title={creator?.origin === 'super_admin' ? t('creators.superAdminLocked') : undefined}
                        onChange={() => toggle(u.id)}
                        className="h-4 w-4 accent-accent"
                        data-testid="user-select"
                      />
                    </td>
                  )}
                  <td className={tdClass}>
                    <div className="flex items-center gap-3 min-w-0">
                      {u.avatarUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element -- remote avatars from the images CDN
                        <img src={u.avatarUrl} alt="" className="hidden sm:block h-10 w-10 rounded-full object-cover shrink-0 bg-surface-2" loading="lazy" />
                      ) : (
                        <span aria-hidden="true" className="hidden sm:block h-10 w-10 rounded-full bg-surface-2 shrink-0" />
                      )}
                      <div className="min-w-0">
                        <Link href={`/users/${encodeURIComponent(u.id)}`} className={`${linkClass} font-medium break-words`} dir="auto" data-testid="user-link">
                          {name}
                        </Link>
                        {u.email && <span className="block md:hidden text-xs text-fg-muted break-words" dir="ltr">{u.email}</span>}
                        {/* Phones: the status column is hidden, so its chips sit under the name */}
                        <div className="md:hidden mt-1"><StatusChips user={u} t={t} /></div>
                      </div>
                    </div>
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-sm text-fg break-all`} dir="ltr">{u.email ?? t('content.none')}</td>
                  <td className={`${tdClass} ${wideOnly}`}>
                    <StatusChips user={u} t={t} />
                  </td>
                  <td className={`${tdClass} text-sm sm:min-w-52`} data-testid="user-tier-cell">
                    {creator && tiers ? (
                      <CreatorTierControl
                        userId={u.id}
                        userName={name}
                        current={creator.assignment && creator.origin ? { ...creator.assignment, origin: creator.origin, assignedByName: creator.assignedByName } : null}
                        tiers={tiers}
                        canManage={canManage}
                        needsTier={creator.needsTier}
                        setTier={setTier}
                      />
                    ) : (
                      <span className="text-fg-muted">{t('content.none')}</span>
                    )}
                    {creator && creator.limitHits7d > 0 && (
                      <div className="mt-1 text-xs">
                        <span className="font-semibold text-warning-fg" data-testid="user-limit-hits">{t('creators.hitsWeek', { count: n(creator.limitHits7d) })}</span>
                        {limited && (
                          <>
                            {' • '}
                            <Link href={tiersHref(limited.id)} className={`${linkClass} underline`} data-testid="user-raise-limit">
                              {t('creators.raiseLimit', { tier: limited.name })}
                            </Link>
                          </>
                        )}
                      </div>
                    )}
                  </td>
                  <td className={`${tdClass} ${wideOnly} text-sm text-fg-muted whitespace-nowrap`}>{u.createdAt ? <time dateTime={u.createdAt}>{formatDate(u.createdAt, locale)}</time> : t('content.none')}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {bulk && (
        <TierChangeDialog
          open={confirming}
          title={t('creators.confirmAssignTitle')}
          body={tierChangeMessage(bulkTarget, t, locale, { count: chosen.length })}
          warning={null}
          confirmLabel={t('creators.assignTier', { tier: bulkTarget?.name ?? '' })}
          danger={false}
          testId="users-bulk-change"
          onCancel={() => setConfirming(false)}
          onConfirm={() => void applyBulk()}
        />
      )}
    </div>
  );
}
