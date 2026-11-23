'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Filter, Plus, Search } from 'lucide-react';
import { PostStatus, PostType, type CommunityPost } from '@al-ummah/shared-types';
import Link from '@/components/common/AppLink';
import { FilterCombobox, type FilterItem } from '@/components/ui/FilterCombobox';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { PostCard } from '@/components/Community/management/PostCard';
import { listCommunityPosts, updateCommunityPost } from '@/lib/api/community-posts';
import { deletePostWithUndo } from '@/lib/community/delete-post';
import { reportError } from '@/lib/errors/reporter';
import { matchesSearch } from '@/lib/search/match';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { cn } from '@/lib/utils';
import { POST_STATUSES, type PostListStatus } from '@/lib/studio/params';

const TYPE_OPTIONS: PostType[] = [PostType.TEXT, PostType.IMAGE, PostType.POLL, PostType.QUIZ, PostType.VIDEO, PostType.GIF];

/**
 * Content → Posts (spec §4.4.3): the channel's posts by status, with search,
 * a type filter, New post, Edit, Delete (with Undo) and, for a scheduled post,
 * Publish now. Moved from /settings/channel/{id}/community. Status is in the URL (?status=).
 */
export function PostsTab({ locale, channelId, status }: { locale: string; channelId: string; status: PostListStatus }) {
  const router = useRouter();
  const { t } = useLanguage();
  const base = `/${locale}/studio/${encodeURIComponent(channelId)}/content/posts`;

  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterType, setFilterType] = useState<PostType | 'all'>('all');
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState('loading');
    try {
      const response = await listCommunityPosts({ channelId, status, page: 1, limit: 50 }, { channelId });
      if (!response) throw new Error('no response');
      // The API's published list also carries the channel's scheduled posts: each tab shows its own
      setPosts((response.posts ?? []).filter((p) => p.status === status));
      setState('ready');
    } catch (error) {
      logger.error('[Studio] Posts not loaded', { channelId, status, error });
      setState('error');
    }
  }, [channelId, status]);

  useEffect(() => {
    void load();
  }, [load]);

  // Suggestions under the search box: the start of each post (or its poll/quiz question)
  const searchItems = useMemo<FilterItem[]>(
    () =>
      posts
        .map((post) => {
          const text = (post.content || post.poll?.question || post.quiz?.question || '').replace(/\s+/g, ' ').trim();
          return { id: post.id, label: text.length > 80 ? `${text.slice(0, 80)}…` : text, keywords: [post.poll?.question, post.quiz?.question] };
        })
        .filter((item) => item.label),
    [posts],
  );

  const filteredPosts = posts.filter(
    (post) =>
      (!searchQuery || matchesSearch(searchQuery, post.content, post.poll?.question, post.quiz?.question)) &&
      (filterType === 'all' || post.type === filterType),
  );

  // A post's own page (/post/{id})
  const handleView = (post: CommunityPost) => router.push(`/${locale}/post/${encodeURIComponent(post.id)}`);
  const handleEdit = (post: CommunityPost) => router.push(`${base}/${encodeURIComponent(post.id)}/edit`);
  // No confirm: a 30-day soft delete; the Undo toast puts the post back in its place
  const handleDelete = async (postId: string) => {
    let removed: { post: CommunityPost; index: number } | null = null;
    await deletePostWithUndo({ id: postId, channelId }, t.community, {
      onRemoved: () =>
        setPosts((prev) => {
          const index = prev.findIndex((p) => p.id === postId);
          if (index >= 0) removed = { post: prev[index], index };
          return prev.filter((p) => p.id !== postId);
        }),
      onRestored: () =>
        setPosts((prev) => {
          if (!removed || prev.some((p) => p.id === postId)) return prev;
          return [...prev.slice(0, removed.index), removed.post, ...prev.slice(removed.index)];
        }),
    });
  };
  // A scheduled post goes live now (subscribers are notified by the processor); it leaves the Scheduled tab
  const handlePublishNow = async (post: CommunityPost) => {
    const result = await updateCommunityPost(channelId, post.id, { publishNow: true }, { channelId });
    if (result?.success) {
      setPosts((prev) => prev.filter((p) => p.id !== post.id));
      setNotice(t.studio.posts.publishedNow);
    } else {
      reportError(new Error('Publish post now refused'), { shown: true, extra: { channelId, postId: post.id, action: 'publish_post_now' } });
      setNotice(t.community.publishFailed);
    }
  };

  const statusLabel: Record<PostListStatus, string> = {
    [PostStatus.PUBLISHED]: t.community.published,
    [PostStatus.SCHEDULED]: t.community.scheduled,
  };
  const filtering = !!searchQuery || filterType !== 'all';

  return (
    <section className="max-w-5xl" aria-labelledby="studio-posts-heading" data-testid="studio-posts" data-status={status}>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="studio-posts-heading" className="text-lg font-semibold text-foreground">{t.community.managePosts}</h2>
        <Button asChild className="min-h-11">
          <Link href={`${base}/new`} data-testid="studio-new-post">
            <Plus aria-hidden="true" className="me-2 h-4 w-4" />
            {t.community.newPost}
          </Link>
        </Button>
      </div>

      <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-center">
        <nav aria-label={t.studio.posts.statusLabel} className="inline-flex shrink-0 rounded-lg border border-border bg-muted p-1">
          {POST_STATUSES.map((item) => (
            <Link
              key={item}
              href={`${base}?status=${item}`}
              aria-current={item === status ? 'page' : undefined}
              data-testid={`studio-posts-status-${item}`}
              className={cn(
                'flex min-h-11 items-center rounded-md px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                item === status ? 'bg-background text-foreground shadow-sm' : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {statusLabel[item]}
            </Link>
          ))}
        </nav>
        <FilterCombobox
          className="relative flex-1"
          value={searchQuery}
          onValueChange={setSearchQuery}
          items={searchItems}
          label={t.community.searchPosts}
          testId="community-posts-search"
          inputClassName="h-11 w-full rounded-md border border-input bg-background ps-10 pe-9 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          icon={<Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
        />
        <Select value={filterType} onValueChange={(v) => setFilterType(v as PostType | 'all')}>
          <SelectTrigger className="min-h-11 w-full md:w-[180px]" aria-label={t.community.filterByType}>
            <Filter aria-hidden="true" className="me-2 h-4 w-4" />
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">{t.community.allTypes}</SelectItem>
            {TYPE_OPTIONS.map((type) => (
              <SelectItem key={type} value={type}>
                {type === PostType.GIF ? 'GIF' : t.community[type as 'text' | 'image' | 'poll' | 'quiz' | 'video']}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      <p role="status" aria-live="polite" className="sr-only">{notice}</p>

      <div className="mt-6">
        {state === 'loading' ? (
          <div role="status" aria-label={t.common.loading} className="space-y-4" data-testid="studio-posts-loading">
            {[1, 2, 3].map((i) => <div key={i} className="h-32 animate-pulse rounded-lg bg-muted motion-reduce:animate-none" />)}
          </div>
        ) : state === 'error' ? (
          <div role="alert" className="rounded-lg border border-destructive/40 bg-card p-4 text-card-foreground" data-testid="studio-posts-error">
            <p className="text-sm">{t.errors.networkError}</p>
            <Button variant="outline" className="mt-3 min-h-11" onClick={() => void load()}>{t.common.retry}</Button>
          </div>
        ) : filteredPosts.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border px-4 py-12 text-center text-muted-foreground" data-testid="studio-posts-empty">
            <p className="text-base">{filtering ? t.community.noResultsFound : t.community.noPostsYet}</p>
            {!filtering && (
              <Button asChild className="mt-4 min-h-11">
                <Link href={`${base}/new`}>
                  <Plus aria-hidden="true" className="me-2 h-4 w-4" />
                  {t.community.createFirstPost}
                </Link>
              </Button>
            )}
          </div>
        ) : (
          <div className="space-y-4">
            {filteredPosts.map((post) => (
              <PostCard key={post.id} post={post} locale={locale} onView={handleView} onEdit={handleEdit} onDelete={handleDelete} onPublishNow={handlePublishNow} />
            ))}
          </div>
        )}
      </div>
    </section>
  );
}
