import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { formatNumber } from '@/i18n/translate';
import type { BillingOverview } from '@/lib/api/billing';
import { providerName } from './provider-name';
import type { PaymentsTab } from './PaymentsView';

export const PAYMENTS_TABS: PaymentsTab[] = ['providers', 'prices', 'tax', 'subscriptions'];

/** The Payments page's title, whether payments are on, the counts and the section tabs. */
export async function PaymentsHeader({ overview, tab }: { overview: BillingOverview | null; tab: PaymentsTab }) {
  const { t, locale } = await getI18n();
  const enabled = overview?.providers.filter((p) => p.enabled) ?? [];
  const counts = overview?.counts;

  return (
    <>
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-fg">{t('payments.title')}</h1>
        <p className="text-fg-muted mt-2 max-w-prose">{t('payments.subtitle')}</p>
        {overview && (
          <p className={`mt-3 inline-block rounded border px-3 py-2 text-sm ${enabled.length ? 'border-border bg-surface-2 text-fg' : 'border-border bg-chip-pending-bg text-chip-pending-fg'}`} data-testid="payments-state" data-on={enabled.length ? 'true' : 'false'}>
            {enabled.length ? t('payments.on', { providers: enabled.map((p) => providerName(t, p.id)).join(locale === 'ar' ? '، ' : ', ') }) : t('payments.off')}
          </p>
        )}
      </div>

      {counts && (
        <dl className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3" data-testid="payments-counts">
          {(
            [
              ['active', counts.active],
              ['pastDue', counts.pastDue],
              ['failedEvents', counts.failedEvents],
            ] as const
          ).map(([key, value]) => (
            <div key={key} className="rounded-lg border border-border bg-surface p-4">
              <dt className="text-sm text-fg-muted">{t(`payments.counts.${key}`)}</dt>
              <dd className={`mt-1 text-2xl font-semibold ${key === 'failedEvents' && value > 0 ? 'text-danger-fg' : 'text-fg'}`}>{formatNumber(value, locale)}</dd>
            </div>
          ))}
        </dl>
      )}

      {/* One row on every width: on a phone it scrolls sideways rather than wrapping under itself */}
      <nav aria-label={t('payments.tabsLabel')} className="mb-6 flex gap-1 overflow-x-auto whitespace-nowrap border-b border-border [scrollbar-width:none]">
        {PAYMENTS_TABS.map((x) => {
          const active = x === tab;
          return (
            <Link
              key={x}
              href={x === 'providers' ? '/payments' : `/payments?tab=${x}`}
              aria-current={active ? 'page' : undefined}
              className={`shrink-0 px-3 py-2 -mb-px border-b-2 ${active ? 'border-accent text-fg font-medium' : 'border-transparent text-fg-muted hover:text-fg'}`}
              data-testid={`payments-tab-${x}`}
            >
              {t(`payments.tabs.${x}`)}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
