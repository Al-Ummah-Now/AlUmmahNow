import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import PostForm from '@/components/studio/posts/PostForm';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

/** Content → Posts → New post, moved from /settings/channel/{id}/community/new. */
export default async function StudioNewPostPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'posts', 'new']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  return (
    <>
      <h1 className="sr-only">{t.studio.tabs.posts}</h1>
      <PostForm locale={locale} channelId={channelId} />
    </>
  );
}
