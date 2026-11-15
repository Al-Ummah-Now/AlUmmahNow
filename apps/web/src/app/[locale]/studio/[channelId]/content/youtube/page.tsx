import { StudioNoAccess } from '@/components/studio/StudioNoAccess';
import { YoutubeImportTab } from '@/components/studio/youtube/YoutubeImportTab';
import { requireStudioPage } from '@/lib/studio/server';

/** Studio → Content → Move from YouTube (wiki AUN-YT-IMPORT). */
export default async function StudioYoutubeImportPage({ params }: { params: Promise<{ locale: string; channelId: string }> }) {
  const { locale, channelId } = await params;
  const access = await requireStudioPage(channelId, ['content', 'youtube']);
  if (!access) return <StudioNoAccess locale={locale} channelId={channelId} />;
  return <YoutubeImportTab locale={locale} channelId={channelId} channelHandle={access.channel.handle ?? null} />;
}
