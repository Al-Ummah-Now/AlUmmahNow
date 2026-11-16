/**
 * The About page (/[locale]/about): the CMS page www serves at /{l}/about/ (AlUmmahNowCMS migration
 * 0021), rendered on the server in this site's theme. The body is markdown turned into React elements
 * (lib/about/markdown.ts), never raw HTML. A page built from page-builder blocks (wiki
 * AUN-CMS-PAGE-BUILDER) is rendered by the shared renderer the CMS preview and www use
 * (lib/about/blocks.ts; a page that is only text keeps the prose card): its HTML escapes every text, so it is safe to insert. A page that opens with
 * a hero shows no header of its own: the hero is its h1.
 */
import '@al-ummah/shared-types/page-blocks.css';
import '@/theme/about.css';
import { Fragment, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { CmsPage, PageSource } from '@/lib/about/cms-page';
import { parseMarkdown, type Inline, type MdBlock } from '@/lib/about/markdown';
import { isBuiltPage, renderAboutBlocks } from '@/lib/about/blocks';
import { AR_TRANSLATIONS, EN_TRANSLATIONS } from '@/lib/i18n';

const MAIN_CONTENT_ID = 'main-content'; // components/SkipLinks (a client module)

function inline(nodes: Inline[]): ReactNode {
  return nodes.map((n, i) => {
    switch (n.t) {
      case 'text':
        return <Fragment key={i}>{n.v}</Fragment>;
      case 'strong':
        return <strong key={i}>{inline(n.c)}</strong>;
      case 'em':
        return <em key={i}>{inline(n.c)}</em>;
      case 'code':
        return <code key={i}>{n.v}</code>;
      case 'link':
        return <a key={i} href={n.href} {...(n.external && /^https?:/.test(n.href) ? { rel: 'noopener' } : {})}>{inline(n.c)}</a>;
    }
  });
}

/** One frosted-glass box per section: a new box at every level-2 heading (text before the first is its own box). */
function sections(blocks: MdBlock[]): MdBlock[][] {
  const out: MdBlock[][] = [];
  for (const b of blocks) {
    if (!out.length || (b.t === 'h' && b.level === 2 && out[out.length - 1]!.length)) out.push([]);
    out[out.length - 1]!.push(b);
  }
  return out;
}

function block(b: MdBlock, i: number): ReactNode {
  switch (b.t) {
    case 'h': {
      const H = `h${b.level}` as 'h2' | 'h3' | 'h4';
      return <H key={i}>{inline(b.c)}</H>;
    }
    case 'p':
      return <p key={i}>{inline(b.c)}</p>;
    case 'ul':
    case 'ol': {
      const L = b.t;
      return <L key={i}>{b.items.map((item, j) => <li key={j}>{inline(item)}</li>)}</L>;
    }
    case 'quote':
      return <blockquote key={i}>{b.blocks.map(block)}</blockquote>;
    case 'hr':
      return <hr key={i} />;
  }
}

export function AboutPage({ page, locale, source, wwwUrl }: { page: CmsPage; locale: 'en' | 'ar'; source: PageSource; wwwUrl: string }) {
  const dir = (l: string) => (l === 'ar' ? 'rtl' : 'ltr');
  const strings = (page.locale === 'ar' ? AR_TRANSLATIONS : EN_TRANSLATIONS).aboutPage;
  const built = isBuiltPage(page.blocks)
    ? renderAboutBlocks(page.blocks, { locale: page.locale, slug: page.slug, title: page.title, wwwUrl, cardsLink: strings.cardsLink })
    : null;
  const blocks = built?.html ? built : null;
  return (
    <main id={MAIN_CONTENT_ID} className={blocks ? 'ab ab-built' : 'ab'} dir={dir(locale)} data-testid="about-page" data-source={source}>
      <article className="ab-article" lang={page.locale} dir={dir(page.locale)}>
        {!blocks?.hero && (
          <header className="ab-head">
            <span className="ab-badge" aria-hidden="true"><Info /></span>
            <div>
              <h1 className="ab-title">{page.title}</h1>
              {page.summary && <p className="ab-lead">{page.summary}</p>}
            </div>
          </header>
        )}
        {blocks ? (
          <div className="ab-blocks" data-testid="about-body" dangerouslySetInnerHTML={{ __html: blocks.html }} />
        ) : (
          <div className="ab-sections" data-testid="about-body">
            {sections(parseMarkdown(page.body, { wwwUrl, locale: page.locale })).map((part, s) => (
              <section key={s} className="ab-card pb-glass">
                <div className="ab-prose">{part.map(block)}</div>
              </section>
            ))}
          </div>
        )}
      </article>
    </main>
  );
}
