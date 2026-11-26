import { SYSTEM_CREDITS, type SystemCreditId } from '@al-ummah/shared-types';

export function WatchSources({ sources, lang, enabled = true }: {
  sources?: readonly SystemCreditId[];
  lang: string;
  enabled?: boolean;
}) {
  const credits = enabled ? SYSTEM_CREDITS.filter((credit) => sources?.includes(credit.id)) : [];
  if (!credits.length) return null;
  const locale = lang === 'ar' ? 'ar' : 'en';

  return (
    <p className="watch-sources aun-start-text" lang={locale} dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      {locale === 'ar' ? 'المصادر: ' : 'Sources: '}
      {credits.map((credit) => (
        <a key={credit.id} href={credit.href} target="_blank" rel="noopener"
          aria-label={locale === 'ar' ? `${credit.name.ar} (يفتح في علامة تبويب جديدة)` : `${credit.name.en} (opens in a new tab)`}>
          {credit.name[locale]}
        </a>
      ))}
    </p>
  );
}
