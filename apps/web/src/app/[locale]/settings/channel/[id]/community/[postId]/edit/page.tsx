import { notFound } from 'next/navigation';
import { getChannelById } from '@/lib/api/channels';
import { getCommunityPost } from '@/lib/api/community-posts';
import { logger } from '@/lib/logger-server';
import EditPostForm from './EditPostForm';

interface EditPostPageProps {
  params: Promise<{ locale: string; id: string; postId: string }>;
}

/**
 * Edit a community post (Story 29.4). The community layout already checked that the viewer may
 * manage this channel's posts; the post is read as the channel, so a scheduled one is found too.
 */
export default async function EditPostPage({ params }: EditPostPageProps) {
  const { locale, id, postId } = await params;
  const [channel, post] = await Promise.all([
    getChannelById(id).catch((error: unknown) => {
      logger.error('Failed to load channel', { error, channelId: id });
      return null;
    }),
    getCommunityPost(id, postId, { channelId: id }).catch((error: unknown) => {
      logger.error('Failed to load community post', { error, channelId: id, postId });
      return null;
    }),
  ]);
  if (!post?.id || post.channelId !== id || post.status === 'deleted') notFound();
  return (
    <EditPostForm
      locale={locale}
      channelId={id}
      post={post}
      channelName={channel?.nameLocalized?.[locale] || channel?.name || ''}
      channelHandle={channel?.handle ?? null}
    />
  );
}
