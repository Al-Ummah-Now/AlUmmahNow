/**
 * The About page (/[locale]/about): the CMS page www serves at /{l}/about/ (AlUmmahNowCMS migration
 * 0021), rendered on the server in this site's theme. The body is markdown turned into React elements
 * (lib/about/markdown.ts), never raw HTML.
 */
import '@/theme/about.css';
import { Fragment, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import type { CmsPage, PageSource } from '@/lib/about/cms-page';
import { parseMarkdown, type Inline, type MdBlock } from '@/lib/about/markdown';

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
  return (
    <main id={MAIN_CONTENT_ID} className="ab" dir={dir(locale)} data-testid="about-page" data-source={source}>
      <article className="ab-article" lang={page.locale} dir={dir(page.locale)}>
        <header className="ab-head">
          <span className="ab-badge" aria-hidden="true"><Info /></span>
          <div>
            <h1 className="ab-title">{page.title}</h1>
            {page.summary && <p className="ab-lead">{page.summary}</p>}
          </div>
        </header>
        <div className="ab-card">
          <div className="ab-prose" data-testid="about-body">
            {parseMarkdown(page.body, { wwwUrl, locale: page.locale }).map(block)}
          </div>
        </div>
      </article>
    </main>
  );
}
