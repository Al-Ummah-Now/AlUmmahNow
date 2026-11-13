import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { SiteVisitsView } from '@/components/site-visits/SiteVisitsView';
import { VISIT_PERIODS, parseVisitPeriod, visitPeriodLabel } from '@/lib/site-visits';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

function pillClass(active: boolean) {
  return `block rounded px-3 py-2 text-sm focus:outline-none focus-visible:ring-2 focus-visible:ring-focus ${
    active ? 'bg-accent text-on-accent font-medium' : 'border border-border text-fg hover:bg-surface-hover'
  }`;
}

/**
 * Site visits (owner decision D-SEO-9, wiki AUN-SEO): how many visits the
 * videos site had in the last 7, 30 or 90 days, where they came from and
 * which pages they started on. Counted on the server without cookies and kept
 * as daily totals only; nothing here is about one visitor. Every admin reads it.
 */
export default async function SiteVisitsPage({ searchParams }: PageProps) {
  const params = await searchParams;
  const days = parseVisitPeriod(params.days);
  const { t } = await getI18n();

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div className="max-w-3xl">
          <h1 className="text-3xl font-bold text-fg">{t('siteVisits.title')}</h1>
          <p className="mt-1 text-fg-muted">{t('siteVisits.subtitle')}</p>
          <p className="mt-1 text-sm text-fg-muted" data-testid="site-visits-privacy">{t('siteVisits.privacy')}</p>
        </div>
        <nav aria-label={t('siteVisits.periodLabel')} data-testid="site-visits-period">
          <ul className="flex flex-wrap gap-1">
            {VISIT_PERIODS.map((p) => (
              <li key={p}>
                <Link href={`?days=${p}`} aria-current={p === days ? 'page' : undefined} className={pillClass(p === days)} data-testid={`site-visits-period-${p}`}>
                  {visitPeriodLabel(t, p)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <SiteVisitsView days={days} />
    </div>
  );
}
