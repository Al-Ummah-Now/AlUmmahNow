'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { numberFormat, fillTemplate } from '@al-ummah/shared-types';
import { OTHER_ORIGIN, originRows, trafficRows, type TrafficData } from '@/lib/studio/analytics';

export function StatCard({ label, value, change, note, locale }: { label: string; value: string; change?: number | null; note?: string; locale?: string }) {
  const { t, lang } = useLanguage();
  // A change in percent (12 = 12%): «+١٢٪» / "+12%"
  const signed = numberFormat(locale ?? lang ?? 'en', { style: 'percent', signDisplay: 'exceptZero', maximumFractionDigits: 0 });
  return (
    <div className="rounded-md border border-border bg-card p-3" data-testid="studio-stat">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {change !== undefined && change !== null && (
        <div className="text-xs text-muted-foreground">
          {t.studio.analytics.change.replace('{change}', signed.format(change / 100))}
        </div>
      )}
      {note && <div className="text-xs text-muted-foreground">{note}</div>}
    </div>
  );
}

/** Sources ranked by views. Bars are the one colour; each row carries its own label and numbers. */
export function TrafficSources({ traffic, locale }: { traffic: TrafficData; locale: string }) {
  const { t } = useLanguage();
  const text = t.studio.analytics;
  const rows = trafficRows(traffic);
  const number = numberFormat(locale);
  const percent = numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const share = (value: number, views: number) => (views > 0 && value < 0.005 ? fillTemplate(locale, text.lessThanOnePercent, { percent: percent.format(0.01) }) : percent.format(value));

  return (
    <section aria-labelledby="studio-traffic" data-testid="studio-traffic">
      <h2 id="studio-traffic" className="mb-1 text-base font-semibold text-foreground">{text.traffic.title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{text.traffic.note}</p>
      {rows.length === 0 ? (
        <p className="text-sm text-muted-foreground">{text.empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((row) => (
            <li key={row.source} className="text-sm" data-testid={`studio-traffic-${row.source}`}>
              <div className="flex justify-between gap-2">
                <span className="text-foreground">{text.traffic.sources[row.source as keyof typeof text.traffic.sources] ?? row.source}</span>
                <span className="tabular-nums text-muted-foreground">{number.format(row.views)} ({share(row.share, row.views)})</span>
              </div>
              <div className="mt-1 h-1.5 rounded bg-muted">
                <div className="h-1.5 rounded bg-primary" style={{ inlineSize: `${Math.max(1, row.share * 100)}%` }} />
              </div>
            </li>
          ))}
        </ul>
      )}
      {traffic.externalHosts.length > 0 && (
        <div className="mt-4">
          <h3 className="mb-1 text-sm font-medium text-foreground">{text.traffic.externalTitle}</h3>
          <ul className="text-sm">
            {traffic.externalHosts.map((host) => (
              <li key={host.host} className="flex justify-between gap-2 border-t border-border py-1">
                <span dir="ltr" className="truncate text-foreground">{host.host}</span>
                <span className="tabular-nums text-muted-foreground">{number.format(host.views)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** A country code in the page language ("EG" → "Egypt" / «مصر»); unknown codes as they are. */
function countryName(code: string, locale: string): string {
  if (!/^[A-Z]{2}$/.test(code)) return code;
  try {
    return new Intl.DisplayNames([locale], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/**
 * Where viewers watch (request origin): app or site, device, country (top 10 + other) and campaign
 * links. Shown only once something was collected, each list only when it has rows.
 */
export function ViewerOrigins({ traffic, locale }: { traffic: TrafficData; locale: string }) {
  const { t } = useLanguage();
  const text = t.studio.analytics.origin;
  const number = numberFormat(locale);
  const percent = numberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });
  const total = traffic.totalViews;
  const named = (map: Record<string, string>, key: string) => map[key] ?? key;
  const lists = [
    { id: 'surfaces', title: text.surfacesTitle, rows: originRows(traffic.surfaces, total), label: (k: string) => named(text.surfaces, k), ltr: false },
    { id: 'devices', title: text.devicesTitle, rows: originRows(traffic.devices, total), label: (k: string) => named(text.devices, k), ltr: false },
    { id: 'countries', title: text.countriesTitle, rows: originRows(traffic.countries, total, 10), label: (k: string) => (k === OTHER_ORIGIN ? text.otherCountries : countryName(k, locale)), ltr: false },
    { id: 'campaigns', title: text.campaignsTitle, rows: originRows(traffic.campaigns, total), label: (k: string) => (k === OTHER_ORIGIN ? text.other : k), ltr: true },
  ].filter((l) => l.rows.length > 0);
  if (lists.length === 0) return null;

  return (
    <section aria-labelledby="studio-origin" data-testid="studio-origin">
      <h2 id="studio-origin" className="mb-1 text-base font-semibold text-foreground">{text.title}</h2>
      <p className="mb-3 text-xs text-muted-foreground">{text.note}</p>
      <div className="grid grid-cols-1 gap-6 sm:grid-cols-2">
        {lists.map((list) => (
          <div key={list.id} data-testid={`studio-origin-${list.id}`}>
            <h3 className="mb-2 text-sm font-medium text-foreground">{list.title}</h3>
            <ul className="space-y-2">
              {list.rows.map((row) => (
                <li key={row.key} className="text-sm" data-testid={`studio-origin-${list.id}-${row.key}`}>
                  <div className="flex justify-between gap-2">
                    <span className="truncate text-foreground" dir={list.ltr && row.key !== OTHER_ORIGIN ? 'ltr' : undefined}>{list.label(row.key)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{number.format(row.views)} ({percent.format(row.share)})</span>
                  </div>
                  <div className="mt-1 h-1.5 rounded bg-muted">
                    <div className="h-1.5 rounded bg-primary" style={{ inlineSize: `${Math.max(1, row.share * 100)}%` }} />
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}
