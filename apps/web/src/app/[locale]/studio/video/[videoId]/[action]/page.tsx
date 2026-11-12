import { notFound, redirect } from 'next/navigation';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getVideoById } from '@/lib/api/videos';
import { getStudioChannels } from '@/lib/studio/server';

export const metadata = { robots: { index: false, follow: false } };

const ACTIONS = new Set(['edit', 'analytics']);

/** /studio/video/{id}/{edit|analytics}: a link with only a video id. */
export default async function StudioVideoPage({ params }: { params: Promise<{ locale: string; videoId: string; action: string }> }) {
  const { locale, videoId, action } = await params;
  if (!ACTIONS.has(action)) notFound();
  const id = encodeURIComponent(videoId);
  const session = await getStudioChannels();
  if (!session) return <StudioSignIn locale={locale} returnTo={`/${locale}/studio/video/${id}/${action}`} />;
  const video = await getVideoById(videoId, undefined, 'edit');
  // Imported videos with no channel have no Studio to open in
  if (!video?.channelId) notFound();
  redirect(`/${locale}/studio/${video.channelId}/content/videos/${id}/${action}`);
}
