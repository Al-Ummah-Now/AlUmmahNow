'use client';

import { CommunityPost } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';

interface ArticlePostProps {
  post: CommunityPost;
}

/** A scholar's article, posted to their channel by the CMS: a card that opens it on www. */
export default function ArticlePost({ post }: ArticlePostProps) {
  const { t } = useLanguage();
  const a = post.article;
  if (!a) return null;
  return (
    <a
      href={a.url}
      lang={a.locale}
      dir="auto"
      data-testid="community-article"
      className="block border border-[var(--fanous-color-divider)] rounded-lg overflow-hidden hover:border-[var(--fanous-color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-focus-ring)] transition-colors"
    >
      {a.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.coverUrl} alt="" loading="lazy" decoding="async" className="w-full aspect-[16/9] object-cover bg-[var(--fanous-color-surface-raised)]" />
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
