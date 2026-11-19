import { notFound } from 'next/navigation';
import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import PostForm from '@/components/studio/posts/PostForm';
import { getCommunityPost } from '@/lib/api/community-posts';
import { getTranslations } from '@/lib/i18n';
import { logger } from '@/lib/logger-server';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string; postId: string }>;
}

/** Content → Posts → Edit post (spec §4.4.3): text, article, link, visibility and comments over the existing PUT route. */
export default async function StudioEditPostPage({ params }: Props) {
  const { locale, channelId, postId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'posts', postId, 'edit']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const post = await getCommunityPost(channelId, postId, { channelId }).catch((error: unknown) => {
    logger.error('[Studio] Post not loaded for editing', { channelId, postId, error });
    return null;
  });
  // A post of another channel is never edited here
  if (!post || post.channelId !== channelId) notFound();
  const t = getTranslations(locale as 'en' | 'ar');
  return (
    <>
      <h1 className="sr-only">{t.studio.posts.editHeading}</h1>
      <PostForm locale={locale} channelId={channelId} post={post} />
    </>
  );
}
