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
      className="block border border-gray-200 dark:border-gray-700 rounded-lg overflow-hidden hover:border-blue-500 dark:hover:border-blue-400 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500 transition-colors"
    >
      {a.coverUrl ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={a.coverUrl} alt="" loading="lazy" decoding="async" className="w-full aspect-[16/9] object-cover bg-gray-100 dark:bg-gray-800" />
      ) : null}
      <div className="p-4 space-y-2 text-start">
        <span className="inline-block text-xs font-medium uppercase tracking-wide text-gray-500 dark:text-gray-400">{t.community.article}</span>
        <h3 className="text-base font-semibold text-gray-900 dark:text-gray-100 break-words">{a.title}</h3>
        {a.excerpt ? <p className="text-sm text-gray-700 dark:text-gray-300 break-words line-clamp-3">{a.excerpt}</p> : null}
        <span className="inline-flex items-center gap-1 text-sm font-medium text-blue-600 dark:text-blue-400">
          {t.community.readArticle}
          <span aria-hidden="true" className="rtl:rotate-180">→</span>
          <span className="sr-only">({t.community.articleOpensSite})</span>
        </span>
      </div>
    </a>
  );
}
