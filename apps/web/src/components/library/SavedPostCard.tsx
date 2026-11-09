'use client';

import React from 'react';
import Link from 'next/link';
import { useLanguage } from '@/hooks/useLanguage';
import type { SavedPost } from '@/services/api/library';

function stripHtml(html: string | undefined): string {
  return (html || '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

export function SavedPostCard({ post }: { post: SavedPost }) {
  const { lang } = useLanguage();
  return (
    <Link
      href={`/${lang}/channels/${encodeURIComponent(post.channelId)}?tab=community`}
      className="block rounded-lg border border-gray-200 p-4 hover:border-[var(--fanous-color-accent)] dark:border-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
      data-testid="library-saved-post"
      data-post-id={post.id}
    >
      {post.channelName && <p className="text-xs font-medium text-gray-500 dark:text-gray-400">{post.channelName}</p>}
      <p className="line-clamp-3 text-sm text-gray-900 dark:text-gray-100">{stripHtml(post.content)}</p>
    </Link>
  );
}

export default SavedPostCard;
