import { requireChannelPage } from '@/lib/channels/guard';

/** Sections: only roles that can use it (see CHANNEL_SETTINGS_PAGES). */
export default async function ChannelSectionsLayout({ children, params }: { children: React.ReactNode; params: Promise<{ locale: string; id: string }> }) {
  const { locale, id } = await params;
  await requireChannelPage(locale, id, 'sections');
  return <>{children}</>;
}
