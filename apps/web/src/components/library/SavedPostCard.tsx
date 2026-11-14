'use client';

import React from 'react';
import Link from '@/components/common/AppLink';
import { useLanguage } from '@/hooks/useLanguage';
import type { SavedPost } from '@/services/api/library';
import { channelLabel } from '@/lib/channel-name';

function stripHtml(html: string | undefined): string {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function SavedPostCard({ post }: { post: SavedPost }) {
  const { lang } = useLanguage();
  return (
    <Link
      href={`/${lang}/post/${encodeURIComponent(post.id)}`}
      className="block rounded-lg border border-gray-200 p-4 hover:border-[var(--fanous-color-accent)] dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      data-testid="library-saved-post"
      data-post-id={post.id}
    >
      {channelLabel(post, lang) && <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{channelLabel(post, lang)}</p>}
      <p className="line-clamp-3 text-sm text-gray-900 dark:text-gray-100">{stripHtml(post.content)}</p>
    </Link>
  );
}

export default SavedPostCard;
