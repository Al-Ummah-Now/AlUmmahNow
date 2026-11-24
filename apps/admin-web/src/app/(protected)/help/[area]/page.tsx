import Link from 'next/link';
import { notFound } from 'next/navigation';
import { getI18n } from '@/i18n/server';
import { helpArea, helpAreas, helpAreaSlugs } from '@/lib/help/content';
import { HelpSearch, type HelpSearchItem } from '@/components/help/HelpSearch';
import { HelpEntryCard, HelpFooterNote } from '@/components/help/HelpGuide';

/** One settings area of the admin guide: a frosted card per setting, at its anchor (wiki AUN-ADMIN-HELP). */
export default async function AdminHelpAreaPage({ params }: { params: Promise<{ area: string }> }) {
  const { area: slug } = await params;
  if (!helpAreaSlugs().includes(slug)) notFound();
  const { t, locale } = await getI18n();
  const area = helpArea(locale, slug);
  if (!area) notFound();
  const items: HelpSearchItem[] = helpAreas(locale).flatMap((a) => a.settings.map((s) => ({ href: s.href, label: s.label, area: a.title, summary: s.summary })));

  return (
    <div className="max-w-5xl" data-testid="admin-help-area" data-area={area.area}>
      <nav aria-label={t('adminHelp.title')} className="mb-3 text-sm">
        <Link href="/help" className="text-link underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">
          {t('adminHelp.backToGuide')}
        </Link>
      </nav>
      <div className="mb-6 max-w-3xl">
        <h1 className="text-3xl font-bold text-fg">{area.title}</h1>
        <p className="text-fg-muted mt-1">{area.intro}</p>
      </div>
      <HelpSearch items={items} />

      <nav aria-labelledby="help-toc-title" className="aun-glass aun-card-pad mt-6 rounded-[var(--aun-radius-card)]" data-testid="help-toc">
        <h2 id="help-toc-title" className="text-sm font-semibold text-fg">
          {t('adminHelp.onThisPage')}
        </h2>
        <ul className="mt-2 grid gap-x-6 gap-y-1 sm:grid-cols-2">
          {area.settings.map((s) => (
            <li key={s.id}>
              <a href={`#${s.anchor}`} className="text-sm text-link underline-offset-2 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-focus rounded">
                {s.label}
              </a>
            </li>
          ))}
        </ul>
      </nav>

      <div className="mt-6 space-y-6">
        {area.settings.map((s) => (
          <HelpEntryCard key={s.id} entry={s} settingHref={`${area.route}`} />
        ))}
      </div>
      <HelpFooterNote />
    </div>
  );
}
