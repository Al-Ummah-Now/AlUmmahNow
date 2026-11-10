'use client';

import Link from 'next/link';
import { BarChart3, Heart, MessageCircle, Pin } from 'lucide-react';
import { RelativeDate } from '@/components/RelativeDate';
import { useLanguage } from '@/hooks/useLanguage';
import type { SectionPostSummary } from '../sectionData';

/**
 * Compact public post cards. Each opens the channel's Community tab, where
 * the full post, poll and comments live. Three columns on wide screens,
 * stacked on phones.
 */
export function CommunityShelf({ posts, channelId }: { posts: SectionPostSummary[]; channelId: string }) {
  const { t, lang, locale } = useLanguage();
  const r = t.channelSections.render;
  const fill = (template: string, count: number) => template.replace('{count}', count.toLocaleString(locale));
  const href = `/${locale}/channels/${channelId}?tab=community`;

  return (
    <ul className="grid items-start gap-4 sm:grid-cols-2 lg:grid-cols-3" role="list">
      {posts.map((post) => (
        <li key={post.id} className="min-w-0">
          <Link
            href={href}
            data-testid="section-post-card"
            data-post-id={post.id}
            className="community-card flex flex-col overflow-hidden rounded-lg border border-border bg-card text-card-foreground hover:border-brand-edge focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {(post.image?.url || post.gifUrl) && (
              // eslint-disable-next-line @next/next/no-img-element -- user media from R2, sizes vary
              <img
                src={post.image?.url || post.gifUrl}
                alt=""
                loading="lazy"
                className="aspect-video w-full bg-muted object-cover"
              />
            )}
            <div className="flex flex-1 flex-col gap-2 p-4">
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                {post.pinned && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-2 py-0.5 font-medium text-brand-ink">
                    <Pin className="h-3 w-3" aria-hidden="true" />
                    {r.pinned}
                  </span>
                )}
                <RelativeDate value={post.createdAt} lang={lang} />
              </div>
              {post.content && (
                <p className="line-clamp-4 whitespace-pre-line text-sm text-foreground" dir="auto">
                  {post.content}
                </p>
              )}
              {post.poll && (
                <div className="rounded-md border border-border px-3 py-2 text-sm">
                  <span className="flex items-center gap-1.5 font-medium text-foreground" dir="auto">
                    <BarChart3 className="h-4 w-4 shrink-0 text-brand" aria-hidden="true" />
                    {post.poll.question}
                  </span>
                  <span className="text-xs text-muted-foreground">{fill(r.pollOptions, post.poll.optionsCount)}</span>
                </div>
              )}
              <div className="mt-auto flex items-center gap-4 pt-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Heart className="h-3.5 w-3.5" aria-hidden="true" />
                  <span aria-hidden="true">{post.likes.toLocaleString(locale)}</span>
                  <span className="sr-only">{fill(r.likes, post.likes)}</span>
                </span>
                <span className="inline-flex items-center gap-1">
                  <MessageCircle className="h-3.5 w-3.5" aria-hidden="true" />
                  <span aria-hidden="true">{post.comments.toLocaleString(locale)}</span>
                  <span className="sr-only">{fill(r.comments, post.comments)}</span>
                </span>
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
