import { requireChannelPage } from '@/lib/channels/guard';

/** Videos: only roles that can use it (see CHANNEL_SETTINGS_PAGES). */
export default async function ChannelVideosLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireChannelPage(locale, id, 'videos');
  return <>{children}</>;
}
