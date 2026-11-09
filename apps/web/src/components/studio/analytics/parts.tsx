'use client';

import { useLanguage } from '@/hooks/useLanguage';
import { trafficRows, type TrafficData } from '@/lib/studio/analytics';

/** 75 -> "1:15", 3725 -> "1:02:05" */
export function formatSeconds(seconds: number): string {
  const total = Math.max(0, Math.round(seconds || 0));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function StatCard({ label, value, change }: { label: string; value: string; change?: number | null }) {
  const { t } = useLanguage();
  return (
    <div className="rounded-md border border-border bg-card p-3" data-testid="studio-stat">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold tabular-nums text-foreground">{value}</div>
      {change !== undefined && change !== null && (
        <div className="text-xs text-muted-foreground">
          {t.studio.analytics.change.replace('{change}', `${change > 0 ? '+' : ''}${change}`)}
        </div>
      )}
    </div>
  );
}

/** Sources ranked by views. Bars are the one colour; each row carries its own label and numbers. */
export function TrafficSources({ traffic, locale }: { traffic: TrafficData; locale: string }) {
  const { t } = useLanguage();
  const text = t.studio.analytics;
  const rows = trafficRows(traffic);
  const number = new Intl.NumberFormat(locale);
  const percent = new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 0 });

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
                <span className="tabular-nums text-muted-foreground">{number.format(row.views)} ({percent.format(row.share)})</span>
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
