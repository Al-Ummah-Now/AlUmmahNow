'use client';

/**
 * Payments → Subscriptions (wiki AUN-SUBS): every subscription and admin comp
 * by status, newest first, with keyset "Load more". A row opens the
 * subscription (payments, webhook events, cancel, refunds). The comp form
 * grants a tier without payment (billing:manage).
 */
import { useCallback, useState } from 'react';
import { ADMIN_BILLING_FILTERS, formatBillingAmount, type AdminBillingFilter, type AdminBillingSubscriptionRow, type AdminBillingSubscriptionsPage } from '@al-ummah/shared-types';
import Link from '@/components/AppLink';
import { useRouter } from 'next/navigation';
import { useLanguage } from '@/i18n/I18nProvider';
import { secondaryButtonClass, linkClass, cardClass } from '@/components/ui';
import { primarySmallButtonClass, smallButtonClass } from '@/components/content/parts';
import { billingRequest } from '@/lib/list/api-client';
import { SUBSCRIPTION_TONE } from '@/lib/payments';
import { ToneChip, providerName, useBillingAction } from './shared';
import { CompForm } from './CompForm';
import type { TierOption } from './PricesPanel';

import { LocalTime } from '@/components/LocalTime';
import { fillNodes } from '@/components/audit/fill';
const PAGE_SIZE = 25;

export function SubscriptionsPanel({ initial, initialFilter, tiers, canManage }: { initial: AdminBillingSubscriptionsPage | null; initialFilter: AdminBillingFilter; tiers: TierOption[]; canManage: boolean }) {
  const router = useRouter();
  const { t, locale } = useLanguage();
  const [filter, setFilter] = useState<AdminBillingFilter>(initialFilter);
  const [items, setItems] = useState<AdminBillingSubscriptionRow[]>(initial?.items ?? []);
  const [next, setNext] = useState<string | null>(initial?.next ?? null);
  const [failed, setFailed] = useState(initial === null);
  const { busy, error, run } = useBillingAction('payments-subscriptions');

  const load = useCallback(
    async (f: AdminBillingFilter, cursor: string | null) => {
      const ok = await run(cursor ? 'more' : 'load', async () => {
        const page = await billingRequest<AdminBillingSubscriptionsPage>('GET', 'subscriptions', { query: { filter: f, cursor: cursor ?? undefined, limit: PAGE_SIZE } });
        setItems((prev) => (cursor ? [...prev, ...page.items] : page.items));
        setNext(page.next);
      });
      setFailed(!ok && !cursor);
    },
    [run],
  );

  const choose = (f: AdminBillingFilter) => {
    setFilter(f);
    try {
      const url = new URL(window.location.href);
      url.searchParams.set('filter', f);
      window.history.replaceState(null, '', url);
    } catch {
      // the address bar keeps the old filter; the list is still right
    }
    void load(f, null);
  };

  return (
    <div className="space-y-4" data-testid="payments-subscriptions">
      {/* After a grant: the list and the page's counts (Active subscriptions) both read again */}
      {canManage && <CompForm tiers={tiers} onDone={async () => { router.refresh(); await load(filter, null); }} />}

      <div role="group" aria-label={t('payments.subs.filterLabel')} className="flex flex-wrap gap-2">
        {ADMIN_BILLING_FILTERS.map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={filter === f}
            onClick={() => choose(f)}
            className={filter === f ? primarySmallButtonClass : smallButtonClass}
            data-testid={`payments-subs-filter-${f}`}
          >
            {t(`payments.subs.filters.${f}`)}
          </button>
        ))}
      </div>

      {(failed || error) && (
        <p role="alert" className="bg-danger-bg border border-danger-border text-danger-fg px-3 py-2 rounded text-sm" data-testid="payments-subs-error">
          {error ?? t('payments.subs.loadFailed')}
        </p>
      )}
      {!failed && items.length === 0 && busy === null && (
        <p className="text-fg-muted" data-testid="payments-subs-empty">
          {t('payments.subs.none')}
        </p>
      )}

      {items.length > 0 && (
        <ul className={`${cardClass} !p-0 divide-y divide-border`} data-testid="payments-subs-list" aria-busy={busy === 'load'}>
          {items.map((s) => {
            // A person by name, never an @handle (handles are channels)
            const name = s.displayName || t('payments.subs.unknownUser');
            const end = s.accessUntil ?? s.currentPeriodEnd;
            return (
              <li key={s.id} className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center" data-testid="payments-sub-row" data-subscription-id={s.id} data-status={s.status}>
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  {s.avatarUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- remote avatar from the images CDN
                    <img src={s.avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full object-cover bg-surface-2" />
                  ) : (
                    <span aria-hidden="true" className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-2 text-fg-muted font-semibold">
                      {name.slice(0, 1).toUpperCase()}
                    </span>
                  )}
                  <div className="min-w-0">
                    <Link href={`/payments/subscriptions/${encodeURIComponent(s.id)}`} className={`${linkClass} font-medium break-words`} dir="auto" aria-label={t('payments.subs.openLabel', { user: name })} data-testid="payments-sub-open">
                      {name}
                    </Link>
                  </div>
                </div>
                {/* Fixed columns from sm up, so tier, provider, status and date line up from row to row */}
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:w-[34rem] sm:shrink-0 sm:grid-cols-[1fr_1fr_1fr_1fr] sm:items-center sm:gap-x-4">
                  <div>
                    <dt className="sr-only">{t('payments.subs.tier')}</dt>
                    <dd className="font-medium text-fg">
                      <bdi>{tiers.find((x) => x.id === s.tierId)?.name ?? s.tierName}</bdi>
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('payments.subs.provider')}</dt>
                    <dd className="text-fg-muted">
                      {providerName(t, s.provider)}
                      {s.mode === 'test' && s.provider !== 'manual' && <span className="ms-1 text-xs">({t('payments.subs.testMode')})</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('payments.subs.status')}</dt>
                    <dd className="flex flex-wrap items-center gap-1">
                      <ToneChip tone={SUBSCRIPTION_TONE[s.status]} testId="payments-sub-status">
                        {t(`payments.status.${s.status}`)}
                      </ToneChip>
                      {s.cancelAtPeriodEnd && s.status === 'active' && <span className="text-xs text-fg-muted">{t('payments.subs.cancelsAtEnd')}</span>}
                    </dd>
                  </div>
                  <div>
                    <dt className="sr-only">{t('payments.subs.periodEnd')}</dt>
                    <dd className="text-fg-muted">
                      {end ? (s.accessUntil ? fillNodes(t('payments.subs.accessUntil'), { date: <LocalTime value={end} /> }) : <LocalTime value={end} />) : '—'}
                      {s.amount !== null && s.currency && (
                        <span className="block sm:ms-2 sm:inline" data-testid="payments-sub-amount">
                          <bdi>{formatBillingAmount(s.amount, s.currency, locale)}</bdi> {s.period ? t(`payments.perPeriod.${s.period}`) : ''}
                        </span>
                      )}
                    </dd>
                  </div>
                </dl>
              </li>
            );
          })}
        </ul>
      )}

      {next && (
        <button type="button" className={secondaryButtonClass} disabled={busy !== null} onClick={() => void load(filter, next)} data-testid="payments-subs-more">
          {busy === 'more' ? t('payments.subs.loading') : t('payments.subs.loadMore')}
        </button>
      )}
    </div>
  );
}
