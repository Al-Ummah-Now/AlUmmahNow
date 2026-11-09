'use client';

/**
 * Multi-type search results (Story 29.8): video, channel, playlist and
 * community post cards.
 */

import { pickLanguage } from '@/lib/format/pick-language';
import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { BadgeCheck, Heart, MessageSquare } from 'lucide-react';
import type { Playlist, SearchPostPayload, SearchResultItem } from '@al-ummah/shared-types';
import { searchVideoToVideoObject } from '@/lib/search/mappers';
import VideoCard from '@/components/videoCard/index';
import { ChannelTile } from '@/components/ChannelTile';
import { PlaylistCard } from '@/components/PlaylistCard';
import { useLanguage } from '@/hooks/useLanguage';
import { resolveUrl } from '@/lib/utility';
import { formatCount } from './labels';
import { RelativeDate } from '@/components/RelativeDate';

function PostResultCard({ post }: { post: SearchPostPayload }) {
  const { t, lang } = useLanguage();
  const date = post.createdAt ? new Date(post.createdAt) : null;
  return (
    <Link
      href={`/${lang}/channels/${post.channelId}?tab=community`}
      data-testid="post-result-card"
      className="flex h-full flex-col gap-3 rounded-lg bg-white dark:bg-gray-900 p-4 shadow-md hover:shadow-lg transition-shadow focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500"
    >
      <div className="flex items-center gap-2 min-w-0">
        <div className="relative h-9 w-9 shrink-0 overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
          {post.channelAvatar && <Image src={resolveUrl(post.channelAvatar)} alt="" fill sizes="36px" className="object-cover" />}
        </div>
        <div className="min-w-0">
          <p className="flex items-center gap-1 text-sm font-semibold text-gray-900 dark:text-white">
            <span className="truncate" dir="auto">{post.channelName}</span>
            {post.channelVerified && <BadgeCheck className="h-4 w-4 shrink-0 text-blue-500" aria-label={t.search.verified} />}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-400">
            {t.search.communityPost}
            {date && !Number.isNaN(date.getTime()) && <> · <RelativeDate value={date} lang={lang} /></>}
          </p>
        </div>
      </div>
      <p dir="auto" className="text-sm text-gray-800 dark:text-gray-100 line-clamp-4 whitespace-pre-line">{post.content}</p>
      {post.imageUrl && (
        <div className="relative aspect-video overflow-hidden rounded-md bg-gray-100 dark:bg-gray-800">
          <Image src={resolveUrl(post.imageUrl)} alt="" fill sizes="(min-width: 768px) 33vw, 100vw" className="object-cover" />
        </div>
      )}
      <div className="mt-auto flex gap-4 text-xs text-gray-500 dark:text-gray-400">
        <span className="inline-flex items-center gap-1"><Heart className="h-3.5 w-3.5" aria-hidden="true" />{t.search.likesCount.replace('{count}', formatCount(post.likes, lang))}</span>
        <span className="inline-flex items-center gap-1"><MessageSquare className="h-3.5 w-3.5" aria-hidden="true" />{t.search.commentsCount.replace('{count}', formatCount(post.comments, lang))}</span>
      </div>
    </Link>
  );
}

export function SearchResultCard({ item }: { item: SearchResultItem }) {
  const { lang } = useLanguage();
  switch (item.type) {
    case 'video':
      return <VideoCard {...searchVideoToVideoObject(item.video, item.channel?.name)} />;
    case 'channel':
      return <ChannelTile channel={{ ...item.channel, nameLocalized: item.channel.nameLocalized, descriptionLocalized: item.channel.descriptionLocalized }} />;
    case 'playlist':
      return (
        <PlaylistCard
          {...({
            id: item.playlist.id,
            name: pickLanguage(item.playlist.name, lang),
            description: item.playlist.description ? pickLanguage(item.playlist.description, lang) : item.playlist.description,
            thumbnailUrl: item.playlist.thumbnailUrl,
            cover: item.playlist.cover,
            videosCount: item.playlist.videosCount,
            channelId: item.playlist.channelId,
            userId: item.playlist.userId ?? '',
            isPublic: true,
            dateCreated: item.playlist.dateCreated ?? '',
            dateModified: item.playlist.dateCreated ?? '',
          } as Playlist)}
        />
      );
    case 'post':
      return <PostResultCard post={item.post} />;
  }
}

export function SearchResultList({ results }: { results: SearchResultItem[] }) {
  const { t } = useLanguage();
  return (
    <ul aria-label={t.search.resultsLabel} className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
      {results.map(item => (
        <li key={`${item.type}-${item.id}`} data-testid="search-result" data-result-type={item.type} data-result-id={item.id}>
          <SearchResultCard item={item} />
        </li>
      ))}
    </ul>
  );
}

export function SearchResultSkeleton() {
  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4" aria-hidden="true">
      {Array.from({ length: 8 }).map((_, index) => (
        <div key={index} className="animate-pulse">
          <div className="mb-2 aspect-video rounded-lg bg-gray-200 dark:bg-gray-800" />
          <div className="mb-2 h-4 w-3/4 rounded bg-gray-200 dark:bg-gray-800" />
          <div className="h-3 w-1/2 rounded bg-gray-200 dark:bg-gray-800" />
        </div>
      ))}
    </div>
  );
}
