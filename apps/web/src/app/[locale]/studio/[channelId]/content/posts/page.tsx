import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { PostsTab, parsePostStatus } from '@/components/studio/posts/PostsTab';
import { getTranslations } from '@/lib/i18n';
import { requireStudioPage } from '@/lib/studio/server';

interface Props {
  params: Promise<{ locale: string; channelId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}

/** Content → Posts (spec §4.4.3), moved from /settings/channel/{id}/community. */
export default async function StudioPostsPage({ params, searchParams }: Props) {
  const { locale, channelId } = await params;
  const { status } = await searchParams;
  const access = await requireStudioPage(channelId, ['content', 'posts']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  const t = getTranslations(locale as 'en' | 'ar');
  return (
    <>
      <h1 className="sr-only">{t.studio.tabs.posts}</h1>
      <PostsTab locale={locale} channelId={channelId} status={parsePostStatus(status)} />
    </>
  );
}
