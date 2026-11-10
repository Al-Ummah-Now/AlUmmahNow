import { requireChannelPage } from '@/lib/channels/guard';

/** Tabs: only roles that can use it (see CHANNEL_SETTINGS_PAGES). */
export default async function ChannelTabsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireChannelPage(locale, id, 'tabs');
  return <>{children}</>;
}
