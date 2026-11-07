'use client';

import { use, useState, useEffect, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { CommunityPost, PostType, PostStatus } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { PostCard } from '@/components/Community/management/PostCard';
import {
  listCommunityPosts,
  deleteCommunityPost
} from '@/lib/api/community-posts';
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
  const { t, isRTL } = useLanguage();

  const [activeTab, setActiveTab] = useState<PostStatus>(PostStatus.PUBLISHED);
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [channelName, setChannelName] = useState<string>('');
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
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
        status: activeTab,
        page: 1,
        limit: 50
      });

      if (response?.posts) {
        setPosts(response.posts);
      }
    } catch (error) {
      logger.error('Failed to load posts', { error, channelId: id, status: activeTab });
    } finally {
      setLoading(false);
    }
  }, [activeTab, id]);

  useEffect(() => {
    loadPosts();
  }, [loadPosts]);

  // Posts are shown on the channel page's Community tab (there is no per-post page)
  const handleView = (post: CommunityPost) => {
    logger.info('Opening community post on channel page', { channelId: id, postId: post.id });
    router.push(`/${locale}/channels/${id}?tab=community`);
  };

  const handleDelete = async (postId: string) => {
    const result = await deleteCommunityPost(id, postId, {
      channelId: id
    });

    if (result?.success) {
      setPosts((prev) => prev.filter(p => p.id !== postId));
    } else {
      logger.error('Failed to delete community post', { channelId: id, postId });
    }
  };

  const filteredPosts = posts.filter(post => {
    const matchesSearch = !searchQuery ||
      post.content?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.poll?.question?.toLowerCase().includes(searchQuery.toLowerCase()) ||
      post.quiz?.question?.toLowerCase().includes(searchQuery.toLowerCase());

    const matchesType = filterType === 'all' || post.type === filterType;

    return matchesSearch && matchesType;
  });

  const tabCounts = {
    [PostStatus.PUBLISHED]: posts.filter(p => p.status === PostStatus.PUBLISHED).length,
    [PostStatus.SCHEDULED]: posts.filter(p => p.status === PostStatus.SCHEDULED).length,
    [PostStatus.DRAFT]: posts.filter(p => p.status === PostStatus.DRAFT).length
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="
        border-b
        bg-card
        sticky top-0
        z-10
      ">
        <div className="
          container
          mx-auto
          px-4 py-3
          md:px-6 md:py-4
        ">
          <ChannelSettingsBreadcrumb
            channelId={id}
            channelName={channelName}
            locale={locale}
            currentPage="community"
            className="mb-4"
          />

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
            <div className="relative flex-1">
              <Search className="
                absolute
                left-3 rtl:right-3 rtl:left-auto
                top-1/2
                transform -translate-y-1/2
                w-4 h-4
                text-muted-foreground
              " />
              <Input
                placeholder={t.community.searchPosts}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="pl-10 rtl:pr-10 rtl:pl-3"
                dir={isRTL ? 'rtl' : 'ltr'}
              />
            </div>

            <div className="flex gap-3">
              <Select value={filterType} onValueChange={(v) => setFilterType(v as PostType | 'all')}>
                <SelectTrigger className="w-full sm:w-[180px]">
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
          <TabsList className="grid w-full sm:w-auto grid-cols-3 mb-6">
            <TabsTrigger value={PostStatus.PUBLISHED}>
              {t.community.published}
              {tabCounts[PostStatus.PUBLISHED] > 0 && (
                <span className="ml-2 rtl:mr-2 rtl:ml-0 text-xs bg-primary/20 px-2 py-0.5 rounded-full">
                  {tabCounts[PostStatus.PUBLISHED]}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value={PostStatus.SCHEDULED}>
              {t.community.scheduled}
              {tabCounts[PostStatus.SCHEDULED] > 0 && (
                <span className="ml-2 rtl:mr-2 rtl:ml-0 text-xs bg-primary/20 px-2 py-0.5 rounded-full">
                  {tabCounts[PostStatus.SCHEDULED]}
                </span>
              )}
            </TabsTrigger>
            <TabsTrigger value={PostStatus.DRAFT}>
              {t.community.drafts}
              {tabCounts[PostStatus.DRAFT] > 0 && (
                <span className="ml-2 rtl:mr-2 rtl:ml-0 text-xs bg-primary/20 px-2 py-0.5 rounded-full">
                  {tabCounts[PostStatus.DRAFT]}
                </span>
              )}
            </TabsTrigger>
          </TabsList>

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
                    onDelete={handleDelete}
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
