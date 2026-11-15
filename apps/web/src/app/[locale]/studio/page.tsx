import { notFound, redirect } from 'next/navigation';
import { getFeatures } from '@/lib/features/server';
import { StudioNoChannel } from '@/components/studio/StudioNoChannel';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getStudioChannels } from '@/lib/studio/server';
import { chooseChannel, studioLanding } from '@/lib/studio/resolve';

export const metadata = { robots: { index: false, follow: false } };

/** /studio: opens the right channel, or offers to create the first one (spec §3.2). */
export default async function StudioPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const [{ locale }, query] = await Promise.all([params, searchParams]);
  const session = await getStudioChannels();
  if (!session) return <StudioSignIn locale={locale} returnTo={`/${locale}/studio`} />;
  const channelId = chooseChannel(session.channels, session.activeChannelId);
  if (!channelId) {
    // No channel, and creating one is off for this account: Studio does not exist for them (hidden when off)
    if (!(await getFeatures()).createChannel) notFound();
    return <StudioNoChannel locale={locale} />;
  }
  redirect(studioLanding(locale, channelId, query.error));
}
