/**
 * Credits (/{locale}/credits): the sources behind what the site shows, linked from the rail's "More"
 * group. Today: Quran Foundation, as QF asked on 2026-11-23 (its full line, "Quran data provided by
 * Quran Foundation (https://quran.foundation/)", with the name of each translation edition we use, on
 * a page viewers can easily reach;
 * https://api-docs.quran.foundation/docs/tutorials/faq#what-attribution-or-copyright-information-should-i-show).
 *
 * The editions come from GET /api/quran/credits: the ones translated caption tracks can show right
 * now, named and credited to their translators as QF's catalogue gives them. Nothing is hand-typed.
 *
 * Laid out like the Community Guidelines page: the page builder's shared classes, one frosted-glass
 * panel per section (`pb-t-raised`), logical properties for both directions.
 */
import '@al-ummah/shared-types/page-blocks.css';
import { QURAN_FOUNDATION_URL } from '@al-ummah/shared-types';
import { MAIN_CONTENT_ID } from '@/components/SkipLinks';
import type { QuranCredits } from '@/lib/credits/quran-credits';
import { CREDITS_COPY } from '@/lib/credits/copy';

/** A language's name in the page's language ("English" / «الإنجليزية»), or the code. */
export function languageName(code: string, locale: 'en' | 'ar'): string {
  try {
    return new Intl.DisplayNames([locale], { type: 'language' }).of(code) ?? code;
  } catch {
    return code;
  }
}

/** QF's line with its URL as a link: "Quran data provided by Quran Foundation (<a>https://quran.foundation/</a>)". */
function AttributionLine({ text }: { text: string }) {
  const at = text.indexOf(QURAN_FOUNDATION_URL);
  if (at < 0) return <>{text}</>;
  return (
    <>
      {text.slice(0, at)}
      <a href={QURAN_FOUNDATION_URL} target="_blank" rel="noopener" dir="ltr" data-testid="credits-qf-link">
        {QURAN_FOUNDATION_URL}
      </a>
      {text.slice(at + QURAN_FOUNDATION_URL.length).replace(/^‎/, '')}
    </>
  );
}

export function CreditsPage({ locale, quran, editionsUnavailable = false }: { locale: 'en' | 'ar'; quran: QuranCredits; editionsUnavailable?: boolean }) {
  const c = CREDITS_COPY[locale];
  const dir = locale === 'ar' ? 'rtl' : 'ltr';
  return (
    <main id={MAIN_CONTENT_ID} dir={dir} data-testid="credits-page" className="w-full flex-1 py-6 md:py-10">
      <div className="pb" lang={locale} dir={dir}>
        <header className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m">
          <div className="pb-in">
            <h1 className="pb-heading">{c.title}</h1>
            <p className="pb-intro">{c.lead}</p>
          </div>
        </header>

        <section aria-labelledby="credits-quran" className="pb-b pb-w-content pb-t-raised pb-a-start pb-s-m" data-testid="credits-quran">
          <div className="pb-in">
            <h2 id="credits-quran" className="pb-heading">
              {c.quran.heading}
            </h2>
            <div className="pb-prose">
              <p data-testid="credits-qf-attribution">
                <AttributionLine text={quran.attribution[locale]} />
              </p>
              {quran.quranText && <p>{c.quran.text}</p>}
              {quran.editions.length > 0 && (
                <>
                  <p>{c.quran.editionsIntro}</p>
                  <ul data-testid="credits-editions">
                    {quran.editions.map((e) => (
                      <li key={e.id} data-edition={e.id}>
                        <bdi>{e.name}</bdi>
                        {e.author && e.author !== e.name && (
                          <>
                            {c.quran.by}
                            <bdi>{e.author}</bdi>
                          </>
                        )}
                        {c.quran.separator}
                        {languageName(e.language, locale)}
                      </li>
                    ))}
                  </ul>
                </>
              )}
              {editionsUnavailable && <p data-testid="credits-editions-unavailable">{c.quran.editionsUnavailable}</p>}
              <p>{c.quran.unaltered}</p>
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}

export default CreditsPage;
