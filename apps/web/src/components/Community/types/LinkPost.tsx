'use client';

import { CommunityPost } from '@al-ummah/shared-types';
import { useLanguage } from '@/hooks/useLanguage';
import { safeHttpUrl, safeImageUrl } from '@/lib/security/safe-input';

const hostOf = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

/** A link post: the creator's comment and a preview card for the outside page (image, title, site name or host) (opens in a new tab, nofollow). */
export default function LinkPost({ post }: { post: CommunityPost }) {
  const { t } = useLanguage();
  const l = post.link;
  const safeHref = l ? safeHttpUrl(l.url) : null;
  if (!l || !safeHref) return null;
  const safeImg = l.image ? safeImageUrl(l.image.url) : null;
  return (
    <div className="space-y-3" data-testid="community-link">
      {post.content ? <p className="text-[var(--fanous-color-text-primary)] whitespace-pre-wrap break-words" dir="auto">{post.content}</p> : null}
      <a
        href={safeHref}
        target="_blank"
        rel="noopener noreferrer nofollow ugc"
        className="flex gap-3 border border-[var(--fanous-color-divider)] rounded-lg overflow-hidden hover:border-[var(--fanous-color-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--fanous-color-focus-ring)]"
      >
        {safeImg ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={safeImg} alt="" loading="lazy" decoding="async" className="w-28 h-28 object-cover shrink-0 bg-[var(--fanous-color-surface-raised)]" />
        ) : null}
        <span className="p-3 space-y-1 min-w-0 text-start">
          <span className="block text-xs text-[var(--fanous-color-text-muted)]" dir="auto" data-testid="community-link-site">{l.siteName || hostOf(safeHref)}</span>
          <span className="block font-semibold text-[var(--fanous-color-text-primary)] break-words [text-wrap:balance]" dir="auto">{l.title || safeHref}</span>
          {l.description ? <span className="block text-sm text-[var(--fanous-color-text-secondary)] line-clamp-2 break-words [text-wrap:balance]" dir="auto">{l.description}</span> : null}
          <span className="sr-only">({t.community.opensOutside})</span>
        </span>
      </a>
    </div>
  );
}
