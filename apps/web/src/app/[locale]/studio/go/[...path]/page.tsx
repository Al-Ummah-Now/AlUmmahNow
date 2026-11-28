import { notFound, redirect } from 'next/navigation';
import { getFeatures } from '@/lib/features/server';
import { StudioNoChannel } from '@/components/studio/StudioNoChannel';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getStudioChannels } from '@/lib/studio/server';
import { chooseChannel } from '@/lib/studio/resolve';
import { isLocaleSupported } from '@/lib/i18n/utils';
import { DEFAULT_LOCALE } from '@/lib/i18n/locales';
import { encodePathSegment } from '@/lib/security/safe-input';

export const metadata = { robots: { index: false, follow: false } };

interface Props {
  params: Promise<{ locale: string; path: string[] }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

/** /studio/go/{path}: a link that doesn't name a channel. */
export default async function StudioGoPage({ params, searchParams }: Props) {
  const { locale: rawLocale, path } = await params;
  const locale = isLocaleSupported(rawLocale) ? rawLocale : DEFAULT_LOCALE;
  const encodedSegments = path.map((segment) => encodePathSegment(segment));
  if (encodedSegments.some((s) => s === null)) notFound();
  const joined = (encodedSegments as string[]).join('/');
  const session = await getStudioChannels();
  if (!session) return <StudioSignIn locale={locale} returnTo={`/${locale}/studio/go/${joined}`} />;
  const channelId = chooseChannel(session.channels, session.activeChannelId);
  if (!channelId) {
    // No channel, and creating one is off for this account: Studio does not exist for them (hidden when off)
    if (!(await getFeatures()).createChannel) notFound();
    return <StudioNoChannel locale={locale} />;
  }
  const safeChannelId = encodePathSegment(channelId);
  if (!safeChannelId) notFound();

  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const item of [value].flat()) if (item !== undefined) query.append(key, item);
  }
  const suffix = query.size > 0 ? `?${query}` : '';
  redirect(`/${locale}/studio/${safeChannelId}/${joined}${suffix}`);
}
