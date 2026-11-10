import { requireChannelPage } from '@/lib/channels/guard';

interface ChannelSettingsLayoutProps {
  children: React.ReactNode;
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Guard for every channel settings page: the owner and anyone holding a
 * channel role get in; each section's own layout narrows it to the role that
 * can use it (edit/tabs/sections need channel.edit, videos need video.edit,
 * playlists and community stay owner-only). Signed-out visitors and users
 * with no role are sent to the public channel page. Site-admin rights alone
 * don't count: a site admin holds no channel role.
 */
export default async function ChannelSettingsLayout({ children, params }: ChannelSettingsLayoutProps) {
  const { locale, id } = await params;
  await requireChannelPage(locale, id, 'overview');
  return <>{children}</>;
}
