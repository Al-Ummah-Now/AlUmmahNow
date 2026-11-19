'use client';

import { FilterCombobox, type FilterItem } from '@/components/ui/FilterCombobox';
import { matchesSearch } from '@/lib/search/match';
import { use, useState, useEffect, useCallback, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { CommunityPost, PostType, PostStatus, formatNumber } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PostCard } from '@/components/Community/management/PostCard';
import {
  listCommunityPosts,
  updateCommunityPost
} from '@/lib/api/community-posts';
import { editPostHref } from '@/components/Community/PostActionsMenu';
import { reportError } from '@/lib/errors/reporter';
import { deletePostWithUndo } from '@/lib/community/delete-post';
import { Plus, Search, Filter } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import { getChannelById } from '@/lib/api/channels';
import { logger } from '@/lib/logger-client';

interface CommunityManagementPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

export default function CommunityManagementPage({ params }: CommunityManagementPageProps) {
  const router = useRouter();
  const { locale, id } = use(params);
  const { t, lang } = useLanguage();

  const [activeTab, setActiveTab] = useState<PostStatus>(PostStatus.PUBLISHED);
  // Every post of the channel (the owner's list includes scheduled ones); the tabs split it by status
  const [allPosts, setAllPosts] = useState<CommunityPost[]>([]);
  const posts = useMemo(() => allPosts.filter((p) => p.status === activeTab), [allPosts, activeTab]);
  const [actionError, setActionError] = useState('');
  const [channelName, setChannelName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  // Suggestions under the search box: the start of each post (or its poll/quiz question)
  const searchItems = useMemo<FilterItem[]>(() => posts.map((post) => {
    const text = (post.content || post.poll?.question || post.quiz?.question || '').replace(/\s+/g, ' ').trim();
    return { id: post.id, label: text.length > 80 ? `${text.slice(0, 80)}…` : text, keywords: [post.poll?.question, post.quiz?.question] };
  }).filter((item) => item.label), [posts]);
  const [filterType, setFilterType] = useState<PostType | 'all'>('all');

  // Fetch channel name
  useEffect(() => {
    const fetchChannel = async () => {
      try {
        const channel = await getChannelById(id);
        if (channel) {
          setChannelName(channel.nameLocalized?.[locale] || channel.name || '');
        }
      } catch (error) {
        logger.error('Failed to load channel', { error, channelId: id });
      }
    };

    fetchChannel();
  }, [id, locale]);

  const loadPosts = useCallback(async () => {
    setLoading(true);
    try {
      const response = await listCommunityPosts({
        channelId: id,
        page: 1,
        limit: 50
      }, { channelId: id });

      if (response?.posts) {
        setAllPosts(response.posts);
      }
    } catch (error) {
      logger.error('Failed to load posts', { error, channelId: id });
    } finally {
      setLoading(false);
    }
  }, [id]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  // A post's own page (/post/{id})
  const handleView = (post: CommunityPost) => {
    router.push(`/${locale}/post/${encodeURIComponent(post.id)}`);
  };

  const handleEdit = (post: CommunityPost) => {
    router.push(editPostHref(locale, post));
  };

  // No confirm: a 30-day soft delete; the Undo toast puts the post back in its place
  const handleDelete = async (postId: string) => {
    setActionError('');
    let removed: { post: CommunityPost; index: number } | null = null;
    await deletePostWithUndo({ id: postId, channelId: id }, t.community, {
      onRemoved: () =>
        setAllPosts((prev) => {
          const index = prev.findIndex((p) => p.id === postId);
          if (index >= 0) removed = { post: prev[index], index };
          return prev.filter((p) => p.id !== postId);
        }),
      onRestored: () =>
        setAllPosts((prev) => {
          if (!removed || prev.some((p) => p.id === postId)) return prev;
          return [...prev.slice(0, removed.index), removed.post, ...prev.slice(removed.index)];
        }),
    });
  };

  // A scheduled post goes live now (subscribers are notified by the processor)
  const handlePublishNow = async (post: CommunityPost) => {
    setActionError('');
    const result = await updateCommunityPost(id, post.id, { publishNow: true }, { channelId: id });
    if (result?.success && result.post) {
      setAllPosts((prev) => prev.map((p) => (p.id === post.id ? { ...p, ...result.post } : p)));
    } else {
      reportError(new Error('Publish post now refused'), { shown: true, extra: { channelId: id, postId: post.id, action: 'publish_post_now' } });
      setActionError(t.community.publishFailed);
    }
  };

  const filteredPosts = posts.filter(post => {
    const matchesQuery = !searchQuery ||
      matchesSearch(searchQuery, post.content, post.poll?.question, post.quiz?.question);

    const matchesType = filterType === 'all' || post.type === filterType;

    return matchesQuery && matchesType;
  });

  const tabCounts = {
    [PostStatus.PUBLISHED]: allPosts.filter(p => p.status === PostStatus.PUBLISHED).length,
    [PostStatus.SCHEDULED]: allPosts.filter(p => p.status === PostStatus.SCHEDULED).length
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="container mx-auto px-4 pt-3 md:px-6 md:pt-4">
        <ChannelSettingsBreadcrumb
          channelId={id}
          channelName={channelName}
          locale={locale}
          currentPage="community"
        />
      </div>
      {/* A flat bar on the page's own background, like the composer's (owner review): the
          breadcrumb sits above it, so the theme's tab-bar band (sticky + nav) never paints it */}
      <div className="sticky top-0 z-10 bg-[var(--fanous-color-background)]" data-testid="community-posts-bar">
        <div className="
          container
          mx-auto
          border-b border-[var(--fanous-color-divider)]
          px-4 py-3
          md:px-6 md:py-4
        ">
          <div className="flex items-center justify-between mb-4">
            <h1 className="text-lg md:text-2xl font-bold">
              {t.community.managePosts}
            </h1>
            <Button onClick={() => router.push(`/${locale}/settings/channel/${id}/community/new`)}>
              <Plus className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
              {t.community.newPost}
            </Button>
          </div>

          <div className="
            flex
            flex-col sm:flex-row
            gap-3
          ">
            <FilterCombobox
              className="relative flex-1"
              value={searchQuery}
              onValueChange={setSearchQuery}
              items={searchItems}
              label={t.community.searchPosts}
              testId="community-posts-search"
              inputClassName="h-9 w-full rounded-md border border-input bg-transparent ps-10 pe-9 text-sm shadow-xs focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              icon={<Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />}
            />

            <div className="flex gap-3">
              <Select value={filterType} onValueChange={(v) => setFilterType(v as PostType | 'all')}>
                <SelectTrigger className="w-full sm:w-[180px]" aria-label={t.community.filterByType}>
                  <Filter className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">
                    {t.community.allTypes}
                  </SelectItem>
                  <SelectItem value={PostType.TEXT}>
                    {t.community.text}
                  </SelectItem>
                  <SelectItem value={PostType.IMAGE}>
                    {t.community.image}
                  </SelectItem>
                  <SelectItem value={PostType.POLL}>
                    {t.community.poll}
                  </SelectItem>
                  <SelectItem value={PostType.QUIZ}>
                    {t.community.quiz}
                  </SelectItem>
                  <SelectItem value={PostType.VIDEO}>
                    {t.community.video}
                  </SelectItem>
                  <SelectItem value={PostType.GIF}>
                    GIF
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
      </div>

      <div className="
        container
        mx-auto
        px-4 py-6
        md:px-6 md:py-8
      ">
        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as PostStatus)}>
          <TabsList className="grid w-full sm:w-auto grid-cols-2 mb-6">
            <TabsTrigger value={PostStatus.PUBLISHED}>
              {t.community.published}
              {tabCounts[PostStatus.PUBLISHED] > 0 && (
                <span className="ml-2 rtl:mr-2 rtl:ml-0 text-xs bg-primary/20 px-2 py-0.5 rounded-full">
                  {formatNumber(lang, tabCounts[PostStatus.PUBLISHED])}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value={PostStatus.SCHEDULED}>
              {t.community.scheduled}
              {tabCounts[PostStatus.SCHEDULED] > 0 && (
                <span className="ml-2 rtl:mr-2 rtl:ml-0 text-xs bg-primary/20 px-2 py-0.5 rounded-full">
                  {formatNumber(lang, tabCounts[PostStatus.SCHEDULED])}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

          {actionError && (
            <p role="alert" className="mb-4 text-sm text-[var(--fanous-color-error-text)]" data-testid="community-action-error">{actionError}</p>
          )}
          <TabsContent value={activeTab} className="mt-0">
            {loading ? (
              <div className="space-y-4">
                {[1, 2, 3].map(i => (
                  <Skeleton key={i} className="h-32 w-full" />
                ))}
              </div>
            ) : filteredPosts.length === 0 ? (
              <div className="
                text-center
                py-12 md:py-16
                text-muted-foreground
              ">
                <p className="text-base md:text-lg">
                  {searchQuery || filterType !== 'all'
                    ? t.community.noResultsFound
                    : t.community.noPostsYet
                  }
                </p>
                {!searchQuery && filterType === 'all' && (
                  <Button
                    className="mt-4"
                    onClick={() => router.push(`/${locale}/settings/channel/${id}/community/new`)}
                  >
                    <Plus className="w-4 h-4 mr-2 rtl:ml-2 rtl:mr-0" />
                    {t.community.createFirstPost}
                  </Button>
                )}
              </div>
            ) : (
              <div className="space-y-4">
                {filteredPosts.map(post => (
                  <PostCard
                    key={post.id}
                    post={post}
                    locale={locale}
                    onView={handleView}
                    onEdit={handleEdit}
                    onDelete={handleDelete}
                    onPublishNow={handlePublishNow}
                  />
                ))}
              </div>
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
