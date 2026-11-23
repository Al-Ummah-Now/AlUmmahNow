import { ADMIN_TIER_REQUEST_FILTERS, type AdminTierRequestRow, type AdminTierRequestsPage } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { PriorityTabs } from '@/components/PriorityTabs';
import { getI18n } from '@/i18n/server';
import { formatNumber, translateDynamic, type Translator } from '@/i18n/translate';
import type { Locale } from '@/i18n/config';
import { approveTierRequest, declineTierRequest, getTierRequestSettings, listTierRequests, type TierRequestSettings } from '@/lib/api/tier-requests';
import { UpgradePageMode } from '@/components/tier-requests/UpgradePageMode';
import { featureStates, type FeatureStates } from '@/lib/features/states';
import { getAdminSession } from '@/lib/auth';
import { canManageCreators } from '@/lib/roles';
import { emailTone, parseTierRequestFilter, requesterName, tierRequestsHref, type EmailTone } from '@/lib/tier-requests';
import { ErrorAlert, cardClass, linkClass, secondaryButtonClass } from '@/components/ui';
import { TierRequestActions } from '@/components/tier-requests/TierRequestActions';
import { logger } from '@/lib/logger';
import { tierLabel } from '@/lib/creator-tiers';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
export const dynamic = 'force-dynamic';

/** Status rail colour on each card: waiting, given, refused, taken back. */
// The shared admin card (components/ui cardClass, the site's card surface), a little tighter for a queue row
const ROW_CARD = cardClass.replace('p-6', 'p-4 sm:p-5');
const RAIL: Record<AdminTierRequestRow['status'], string> = {
  pending: 'border-s-chip-pending-fg',
  approved: 'border-s-chip-resolved-fg',
  declined: 'border-s-danger-border',
  withdrawn: 'border-s-border',
};
const STATUS_CHIP: Record<AdminTierRequestRow['status'], string> = {
  pending: 'bg-chip-pending-bg text-chip-pending-fg',
  approved: 'bg-chip-resolved-bg text-chip-resolved-fg',
  declined: 'bg-danger-bg text-danger-fg',
  withdrawn: 'bg-chip-dismissed-bg text-chip-dismissed-fg',
};
const EMAIL_CHIP: Record<EmailTone, string> = {
  progress: 'border-border text-fg-muted',
  done: 'border-border text-fg-muted',
  none: 'border-border text-fg-subtle',
  failed: 'border-danger-border text-danger-fg',
};

/**
 * Tier requests (wiki AUN-TIER-REQUESTS): what users asked for on /upgrade.
 * Pending first and oldest first, so the longest wait is on top; each card
 * shows who asked, the tier they hold and want, what they wrote, and (for
 * admins) Approve and Decline.
 */
export default async function TierRequestsPage({ searchParams }: { searchParams: Promise<{ filter?: string; cursor?: string }> }) {
  const { t, locale } = await getI18n();
  const session = await getAdminSession();
  const canDecide = canManageCreators(session?.user.role);
  const { filter: rawFilter, cursor } = await searchParams;
  const filter = parseTierRequestFilter(rawFilter);
  let page: AdminTierRequestsPage | null = null;
  let settings: TierRequestSettings | null = null;
  let features: FeatureStates = {};
  try {
    [page, settings, features] = await Promise.all([
      listTierRequests({ filter, cursor, pageSize: 25 }),
      getTierRequestSettings().catch((e) => {
        logger.warn('[tier-requests] Could not load the settings', { error: e instanceof Error ? e.message : String(e) });
        return null;
      }),
      featureStates(),
    ]);
  } catch (error) {
    logger.error('[tier-requests] Failed to load', { filter, error: error instanceof Error ? error.message : String(error) });
  }

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('tierRequests.title')}</h1>
        <p className="text-fg-muted mt-2 max-w-prose">{t('tierRequests.subtitle')}</p>
        {!canDecide && <p className="text-fg-muted mt-2 text-sm" data-testid="tier-requests-read-only">{t('tierRequests.readOnly')}</p>}
      </div>
      {settings && <UpgradePageMode allowed={settings.allowed} providerEnabled={settings.providerEnabled} feature={features.tierRequests} />}

      {/* One row: the tabs that fit, the rest under "More" (#1669: never a tab cut at the edge or wrapped) */}
      <PriorityTabs
        label={t('tierRequests.tabsLabel')}
        testId="tier-requests-tabs"
        className="mb-6 border-b border-border"
        rowClassName="gap-1"
        tabClassName="block whitespace-nowrap px-3 py-2 -mb-px border-b-2"
        currentClassName="border-accent text-fg font-medium"
        idleClassName="border-transparent text-fg-muted hover:text-fg"
        tabTestIdPrefix="tier-requests-tab-"
        tabs={ADMIN_TIER_REQUEST_FILTERS.map((f) => ({
          id: f,
          label: t(`tierRequests.filters.${f}`),
          href: tierRequestsHref(f),
          current: f === filter,
          extra: f === 'pending' && !!page?.pending ? (
            <span className="ms-2 text-xs rounded bg-chip-pending-bg text-chip-pending-fg px-1.5 py-0.5" data-testid="tier-requests-pending-count">
              {formatNumber(page.pending, locale)}
            </span>
          ) : undefined,
        }))}
      />

      {!page && <ErrorAlert testId="tier-requests-error">{t('tierRequests.loadFailed')}</ErrorAlert>}
      {page && page.items.length === 0 && (
        <p className="text-fg-muted" data-testid="tier-requests-empty">{filter === 'pending' && !cursor ? t('tierRequests.emptyPending') : t('tierRequests.empty')}</p>
      )}
      {page && page.items.length > 0 && (
        <ul className="space-y-4" data-testid="tier-requests-list">
          {page.items.map((row) => (
            <RequestCard key={row.id} row={row} t={t} locale={locale} canDecide={canDecide} />
          ))}
        </ul>
      )}
      {page?.next && (
        <p className="mt-6">
          <Link href={tierRequestsHref(filter, page.next)} className={secondaryButtonClass} data-testid="tier-requests-more">
            {t('tierRequests.more')}
          </Link>
        </p>
      )}
    </div>
  );
}

function RequestCard({ row, t, locale, canDecide }: { row: AdminTierRequestRow; t: Translator; locale: Locale; canDecide: boolean }) {
  const who = requesterName(row);
  const tone = emailTone(row.emailStatus);
  const headingId = `tier-request-${row.id}`;
  return (
    <li
      className={`${ROW_CARD} border-s-4 ${RAIL[row.status]}`}
      aria-labelledby={headingId}
      data-testid="tier-request-row"
      data-request-id={row.id}
      data-user-id={row.userId}
      data-status={row.status}
      data-email={row.emailStatus ?? ''}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {row.avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- profile avatars come from the CDN at their own sizes
            <img src={row.avatarUrl} alt="" className="h-11 w-11 shrink-0 rounded-full object-cover bg-surface-2" loading="lazy" />
          ) : (
            <span aria-hidden="true" className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted font-semibold">
              {[...who][0]?.toUpperCase() ?? '?'}
            </span>
          )}
          <div className="min-w-0">
            <h2 id={headingId} className="text-base font-semibold text-fg">
              <Link href={`/users/${encodeURIComponent(row.userId)}`} className={linkClass} dir="auto" data-testid="tier-request-user">
                {who}
              </Link>
            </h2>
            {/* No @handle under a person: handles belong to channels (owner rule) */}
            <p className="mt-2 flex flex-wrap items-center gap-2 text-sm">
              <span className="rounded border border-border px-2 py-0.5 text-fg-muted" data-testid="tier-request-holds">{t('tierRequests.holds', { tier: tierLabel({ name: row.currentTierName, nameAr: row.currentTierNameAr }, locale) })}</span>
              <span aria-hidden="true" className="text-fg-subtle rtl:-scale-x-100">→</span>
              <span className="rounded bg-surface-2 px-2 py-0.5 font-medium text-fg" data-testid="tier-request-asks">{t('tierRequests.asks', { tier: tierLabel({ name: row.tierName, nameAr: row.tierNameAr }, locale) })}</span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-col gap-1 text-sm text-fg-muted sm:items-end">
          <span className={`self-start sm:self-end rounded px-2 py-0.5 font-medium ${STATUS_CHIP[row.status]}`} data-testid="tier-request-status">
            {translateDynamic(t, 'tierRequests.status', row.status)}
          </span>
          <span>{fillNodes(t('tierRequests.requested'), { date: <LocalTime value={row.createdAt} withTime /> })}</span>
          {row.decidedAt && (
            <time dateTime={row.decidedAt}>
              {fillNodes(t('tierRequests.decided', { status: translateDynamic(t, 'tierRequests.status', row.status) }), { date: <LocalTime value={row.decidedAt} withTime /> })}
            </time>
          )}
        </div>
      </div>

      <dl className="mt-4 grid gap-3 text-sm">
        {row.name !== row.displayName && (
          <div>
            <dt className="text-fg-muted">{t('tierRequests.nameGiven')}</dt>
            <dd className="text-fg" dir="auto">{row.name}</dd>
          </div>
        )}
        <div>
          <dt className="text-fg-muted">{t('tierRequests.about')}</dt>
          <dd className="mt-1 whitespace-pre-wrap break-words rounded border-s-2 border-border bg-surface-2 px-3 py-2 text-fg" dir="auto" data-testid="tier-request-about">
            {row.about}
          </dd>
        </div>
        {row.declineReason && (
          <div>
            <dd className="text-fg" dir="auto" data-testid="tier-request-reason">{t('tierRequests.reason', { reason: row.declineReason })}</dd>
          </div>
        )}
      </dl>

      {(tone || (row.status === 'pending' && canDecide)) && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border pt-4 sm:flex-row sm:items-center sm:justify-between">
          {tone ? (
            <span className={`self-start rounded border px-2 py-0.5 text-xs ${EMAIL_CHIP[tone]}`} data-testid="tier-request-email">
              {translateDynamic(t, 'tierRequests.email', row.emailStatus ?? '')}
            </span>
          ) : (
            <span />
          )}
          {row.status === 'pending' && canDecide && <TierRequestActions id={row.id} name={who} tier={tierLabel({ name: row.tierName, nameAr: row.tierNameAr }, locale)} actions={{ approve: approveTierRequest, decline: declineTierRequest }} />}
        </div>
      )}
    </li>
  );
}
