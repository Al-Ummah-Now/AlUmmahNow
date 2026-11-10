import { requireChannelPage } from '@/lib/channels/guard';

/** Edit: only roles that can use it (see CHANNEL_SETTINGS_PAGES). */
export default async function ChannelEditLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireChannelPage(locale, id, 'edit');
  return <>{children}</>;
}
