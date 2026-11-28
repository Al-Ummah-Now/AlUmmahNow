import { notFound, redirect } from 'next/navigation';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getVideoById } from '@/lib/api/videos';
import { getStudioChannels } from '@/lib/studio/server';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { encodePathSegment } from '@/lib/security/safe-input';

export const metadata = { robots: { index: false, follow: false } };

const ACTIONS = new Set(['edit', 'analytics']);

/** /studio/video/{id}/{edit|analytics}: a link with only a video id. */
export default async function StudioVideoPage({ params }: { params: Promise<{ locale: string; videoId: string; action: string }> }) {
  const { locale: rawLocale, videoId, action } = await params;
  if (!ACTIONS.has(action)) notFound();
  const locale = isLocaleSupported(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const id = encodePathSegment(videoId);
  if (!id) notFound();
  const session = await getStudioChannels();
  if (!session) return <StudioSignIn locale={locale} returnTo={`/${locale}/studio/video/${id}/${action}`} />;
  const video = await getVideoById(videoId, undefined, 'edit');
  // Imported videos with no channel have no Studio to open in
  const safeChannelId = video?.channelId ? encodePathSegment(video.channelId) : null;
  if (!safeChannelId) notFound();
  redirect(`/${locale}/studio/${safeChannelId}/content/videos/${id}/${action}`);
}
