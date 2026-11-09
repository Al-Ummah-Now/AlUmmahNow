import Link from 'next/link';
import { ChevronRight, LayoutGrid, Layers, ListVideo, Pencil, Users, Video } from 'lucide-react';
import { getTranslations } from '@/lib/i18n';

interface ChannelSettingsPageProps {
  params: Promise<{
    locale: string;
    id: string;
  }>;
}

/**
 * Channel settings overview. The layout (ownership guard, channel header and
 * settings tabs) wraps it; this lists what each section changes.
 */
export default async function ChannelSettingsPage({ params }: ChannelSettingsPageProps) {
  const { locale, id } = await params;
  const t = getTranslations(locale as 'en' | 'ar');
  const base = `/${locale}/settings/channel/${id}`;

  const sections = [
    { key: 'edit', href: `${base}/edit`, icon: Pencil, title: t.channel.customizeChannel, description: t.channel.editChannelDetails },
    { key: 'videos', href: `${base}/videos`, icon: Video, title: t.video.videoManagement, description: t.video.manageVideosDescription || 'Manage your channel videos' },
    { key: 'playlists', href: `${base}/playlists`, icon: ListVideo, title: t.playlist.managePlaylists, description: t.playlist.managePlaylistsDescription },
    { key: 'tabs', href: `${base}/tabs`, icon: Layers, title: t.channel.tabs?.manage_tabs || 'Manage Tabs', description: t.channel.tabs?.manage_tabs_description || 'Customize channel tabs' },
    { key: 'sections', href: `${base}/sections`, icon: LayoutGrid, title: t.channel.manageSections || 'Manage Sections', description: t.channel.customizeChannelLayout || 'Customize layout' },
    { key: 'community', href: `${base}/community`, icon: Users, title: t.channel.communitySettings || 'Community', description: t.channel.manageCommunityPosts || 'Manage posts' },
  ];

  return (
    <div className="container mx-auto px-4 py-6 md:py-8" dir={locale === 'ar' ? 'rtl' : 'ltr'}>
      <h2 className="sr-only">{t.channel.channelSettings}</h2>
      <ul className="grid grid-cols-1 md:grid-cols-2 gap-px rounded-2xl overflow-hidden border border-gray-200 dark:border-gray-800 bg-gray-200 dark:bg-gray-800">
        {sections.map(({ key, href, icon: Icon, title, description }) => (
          <li key={key} className="bg-white dark:bg-gray-900">
            <Link href={href} className="group flex items-center gap-4 p-4 md:p-5 min-h-20 hover:bg-gray-50 dark:hover:bg-gray-800/60" data-testid={`channel-settings-${key}`}>
              <Icon className="w-5 h-5 shrink-0 text-[var(--inline-edit-ring)]" aria-hidden="true" />
              <span className="flex-1 min-w-0">
                <span className="block font-semibold text-gray-900 dark:text-white">{title}</span>
                <span className="block text-sm text-gray-600 dark:text-gray-400 mt-0.5">{description}</span>
              </span>
              <ChevronRight className="w-5 h-5 shrink-0 text-gray-400 rtl:rotate-180 group-hover:text-[var(--inline-edit-ring)]" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
