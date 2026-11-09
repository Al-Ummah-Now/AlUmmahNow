import { redirect } from 'next/navigation';
import { StudioNoChannel } from '@/components/studio/StudioNoChannel';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getStudioChannels } from '@/lib/studio/server';
import { chooseChannel } from '@/lib/studio/resolve';

export const metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: string; path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** /studio/go/{path}: a link that doesn't name a channel. */
export default async function StudioGoPage({ params, searchParams }: Props) {
  const { locale, path } = await params;
  const session = await getStudioChannels();
  const joined = path.map(encodeURIComponent).join('/');
  if (!session) return <StudioSignIn locale={locale} returnTo={`/${locale}/studio/go/${joined}`} />;
  const channelId = chooseChannel(session.channels, session.activeChannelId);
  if (!channelId) return <StudioNoChannel locale={locale} />;

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) if (item !== undefined) query.append(key, item);
  }
  const suffix = query.size > 0 ? `?${query}` : '';
  redirect(`/${locale}/studio/${channelId}/${joined}${suffix}`);
}
