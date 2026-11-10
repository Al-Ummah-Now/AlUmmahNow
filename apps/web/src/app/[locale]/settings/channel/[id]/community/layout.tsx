import { requireChannelPage } from '@/lib/channels/guard';

/** Community: only roles that can use it (see CHANNEL_SETTINGS_PAGES). */
export default async function ChannelCommunityLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireChannelPage(locale, id, 'community');
  return <>{children}</>;
}
