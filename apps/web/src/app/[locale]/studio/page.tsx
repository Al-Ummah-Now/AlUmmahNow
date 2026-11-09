import { redirect } from 'next/navigation';
import { StudioNoChannel } from '@/components/studio/StudioNoChannel';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getStudioChannels } from '@/lib/studio/server';
import { chooseChannel } from '@/lib/studio/resolve';

export const metadata = { robots: { index: false, follow: false } };

/** /studio: opens the right channel, or offers to create the first one (spec §3.2). */
export default async function StudioPage({ params }: { params: Promise<{ locale: string }> }) {
  const { locale } = await params;
  const session = await getStudioChannels();
  if (!session) return <StudioSignIn locale={locale} returnTo={`/${locale}/studio`} />;
  const channelId = chooseChannel(session.channels, session.activeChannelId);
  if (!channelId) return <StudioNoChannel locale={locale} />;
  redirect(`/${locale}/studio/${channelId}/dashboard`);
}
