'use client';

import { CommunityPost } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import PostMarkdown from './PostMarkdown';

interface ArticlePostProps {
  post: CommunityPost;
}

const linkClass = 'inline-flex items-center gap-1 text-sm font-medium text-[var(--fanous-color-link)] min-h-[44px]';

/**
 * An article post. A PostV2 article (written in Studio, or converted from the CMS) shows its title,
 * cover and summary, and opens its full text in place. An older link-only mirror is a card that opens
 * the article on www.
 */
export default function ArticlePost({ post }: ArticlePostProps) {
  const { t } = useLanguage();
  const a = post.article;
  if (!a) return null;
  const cover = a.cover?.url ?? a.coverUrl;
  const wwwUrl = post.www?.url ?? a.url;

  if (typeof a.body === 'string') {
    return (
      <article lang={a.locale} dir={a.locale === 'ar' ? 'rtl' : 'ltr'} data-testid="community-article" className="border border-[var(--fanous-color-divider)] rounded-lg overflow-hidden">
        {cover ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={cover} alt={a.cover?.alt ?? ''} loading="lazy" decoding="async" className="w-full aspect-[16/9] object-cover bg-[var(--fanous-color-surface-raised)]" />
        ) : null}
        <div className="p-4 space-y-2 text-start">
          <span className="inline-block text-xs font-medium uppercase tracking-wide text-[var(--fanous-color-text-muted)]">{t.community.article}</span>
          <h3 className="text-base font-semibold text-[var(--fanous-color-text-primary)] break-words">{a.title}</h3>
          {a.excerpt ? <p className="text-sm text-[var(--fanous-color-text-secondary)] break-words">{a.excerpt}</p> : null}
          <details className="group" data-testid="community-article-body">
            <summary className={`${linkClass} cursor-pointer list-none`}>
              {t.community.readArticle}
              <span aria-hidden="true" className="group-open:rotate-90 rtl:rotate-180 rtl:group-open:rotate-90 transition-transform">→</span>
            </summary>
            <div className="pt-3">
              <PostMarkdown source={a.body} />
            </div>
          </details>
          {wwwUrl ? (
            <a href={wwwUrl} className={linkClass} data-testid="community-article-www">
              {t.community.onWww}
              <span aria-hidden="true" className="rtl:rotate-180">→</span>
            </a>
          ) : null}
        </div>
      </article>
    );
  }

  if (!wwwUrl) return null;
  return (
    <a
      href={wwwUrl}
      lang={a.locale}
      dir="auto"
      data-testid="community-article"
      className="block border border-[var(--fanous-color-divider)] rounded-lg overflow-hidden hover:border-[var(--fanous-color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-focus-ring)] transition-colors"
    >
      {cover ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={cover} alt="" loading="lazy" decoding="async" className="w-full aspect-[16/9] object-cover bg-[var(--fanous-color-surface-raised)]" />
      ) : null}
      <div className="p-4 space-y-2 text-start">
        <span className="inline-block text-xs font-medium uppercase tracking-wide text-[var(--fanous-color-text-muted)]">{t.community.article}</span>
        <h3 className="text-base font-semibold text-[var(--fanous-color-text-primary)] break-words">{a.title}</h3>
        {a.excerpt ? <p className="text-sm text-[var(--fanous-color-text-secondary)] break-words line-clamp-3">{a.excerpt}</p> : null}
        <span className="inline-flex items-center gap-1 text-sm font-medium text-[var(--fanous-color-link)]">
          {t.community.readArticle}
          <span aria-hidden="true" className="rtl:rotate-180">→</span>
          <span className="sr-only">({t.community.articleOpensSite})</span>
        </span>
      </div>
    </a>
  );
}
