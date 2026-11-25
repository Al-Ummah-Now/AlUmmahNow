import { notFound } from 'next/navigation';
import ChannelSettingsBreadcrumb from '@/components/ChannelSettingsBreadcrumb';
import MoveChannel from '@/components/ChannelMoves/MoveChannel';
import { getChannelById } from '@/lib/api/channels';
import { getServerAuthContext } from '@/lib/api/server-auth';
import { decodeJwtPayload } from '@/lib/auth/token-refresh';
import { channelMovesOff } from '@/lib/channels/moves-server';
import { getTranslations } from '@/lib/i18n';

/**
 * Channel settings → Move channel (wiki AUN-CHANNEL-CLAIM §5). In its own route group, outside the
 * channel settings guard: someone who comes back from signing in as another account must be told it
 * isn't their channel, not be sent to the channel page. The API decides who the owner is.
 */
export default async function MoveChannelPage({ params }: { params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  if (await channelMovesOff()) notFound();
  const auth = await getServerAuthContext();
  // A private channel doesn't show to another account: they are told it isn't theirs below
  const channel = await getChannelById(id).catch(() => null);
  const m = getTranslations(locale as 'en' | 'ar').channelMoves;
  const authTime = decodeJwtPayload(auth?.accessToken)?.auth_time;

  return (
    <main className="min-h-screen">
      <div className="container mx-auto max-w-3xl px-4 py-8">
        <ChannelSettingsBreadcrumb channelId={id} channelName={channel ? channel.nameLocalized?.[locale] || channel.name : undefined} channelHandle={channel?.handle} locale={locale} currentPage="move" className="mb-6" />
        <h1 className="text-2xl font-bold text-[var(--fanous-color-text-primary)]">{m.title}</h1>
        <p className="mb-6 mt-1 text-[var(--fanous-color-text-secondary)]">{m.description}</p>
        <MoveChannel channelId={id} handle={channel?.handle || id} locale={locale} authTime={typeof authTime === 'number' ? authTime : null} signedIn={!!auth} />
      </div>
    </main>
  );
}
