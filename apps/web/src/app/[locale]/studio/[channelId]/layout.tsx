import { notFound } from 'next/navigation';
import { StudioFrame } from '@/components/studio/StudioFrame';
import { StudioSignIn } from '@/components/studio/StudioSignIn';
import { getStudioAccess } from '@/lib/studio/server';

export const metadata = { robots: { index: false, follow: false } };

interface Props {
  children: React.ReactNode;
  params: Promise<{ locale: string; channelId: string }>;
}

/** Loads the channel and role once for every page of this channel's Studio. */
export default async function StudioChannelLayout({ children, params }: Props) {
  const { locale, channelId } = await params;
  const access = await getStudioAccess(channelId);
  if (access.status === 'signed-out') {
    return <StudioSignIn locale={locale} returnTo={`/${locale}/studio/${encodeURIComponent(channelId)}/dashboard`} />;
  }
  // The same answer for "no such channel" and "not yours", so private channels aren't revealed
  if (access.status === 'none') notFound();

  const { channel, role } = access;
  return (
    <StudioFrame
      locale={locale}
      role={role}
      channel={{
        id: channel.id,
        name: channel.nameLocalized?.[locale] || channel.name,
        avatarUrl: channel.avatarUrl,
        handle: channel.handle,
        isHidden: Boolean((channel as { isHidden?: boolean }).isHidden),
      }}
    >
      {children}
    </StudioFrame>
  );
}
