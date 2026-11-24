import Link from '@/components/AppLink';
import { getI18n } from '@/i18n/server';
import { helpAreas } from '@/lib/help/content';
import { HelpSearch, matchHelp, type HelpSearchItem } from '@/components/help/HelpSearch';
import { HelpFooterNote } from '@/components/help/HelpGuide';

/**
 * The admin guide (wiki AUN-ADMIN-HELP): every settings area of the videos admin, searchable.
 * Every admin role can read it. ?q= lists the matching settings (Enter in the search box).
 */
export default async function AdminHelpPage({ searchParams }: { searchParams: Promise<{ q?: string | string[] }> }) {
  const { t, locale } = await getI18n();
  const raw = (await searchParams).q;
  const q = (Array.isArray(raw) ? raw[0] : raw)?.trim().slice(0, 200) ?? '';
  const areas = helpAreas(locale);
  const items: HelpSearchItem[] = areas.flatMap((a) => a.settings.map((s) => ({ href: s.href, label: s.label, area: a.title, summary: s.summary })));
  const matches = q ? matchHelp(items, q) : [];

  return (
    <div className="max-w-5xl" data-testid="admin-help">
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{t('adminHelp.title')}</h1>
        <p className="text-fg-muted mt-1">{t('adminHelp.subtitle')}</p>
      </div>
      <HelpSearch items={items} defaultValue={q} />

      {q && (
        <section className="aun-glass aun-card-pad mt-6 rounded-[var(--aun-radius-card)]" aria-labelledby="help-results-title" data-testid="help-results">
          <h2 id="help-results-title" className="text-lg font-semibold text-fg">
            {matches.length ? t('adminHelp.matches', { count: matches.length }) : t('adminHelp.noMatches', { query: q })}
          </h2>
          <ul className="mt-3 space-y-3">
            {matches.map((m) => (
              <li key={m.href}>
                <Link href={m.href} className="font-medium text-link underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">
                  {m.label}
                </Link>
                <span className="text-sm text-fg-muted"> · {m.area}</span>
                <p className="text-sm text-fg-muted">{m.summary.replace(/`/g, '')}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <ul className="mt-6 grid gap-4 md:grid-cols-2" data-testid="help-areas">
        {areas.map((a) => (
          <li key={a.area} className="aun-glass aun-card-pad flex flex-col rounded-[var(--aun-radius-card)]" data-testid="help-area-card" data-area={a.area}>
            <h2 className="text-lg font-semibold text-fg">{a.title}</h2>
            <p className="mt-1 text-sm text-fg-muted">{t('adminHelp.areaCount', { count: a.settings.length })}</p>
            <p className="mt-3 text-sm text-fg">{a.intro}</p>
            <div className="aun-actions mt-auto pt-4">
              <Link href={`/help/${a.area}`} className="aun-btn aun-btn-tonal" aria-label={`${t('adminHelp.openArea')}: ${a.title}`}>
                {t('adminHelp.openArea')}
              </Link>
            </div>
          </li>
        ))}
      </ul>
      <HelpFooterNote />
    </div>
  );
}
