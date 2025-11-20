'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Channel } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/lib/i18n';

interface ChannelTabsProps {
  channel: Channel;
  locale: string;
}

export function ChannelTabs({ channel, locale }: ChannelTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = getTranslations(locale as 'en' | 'ar');

  const tabs = getVisibleTabs(channel, t);

  return (
    <div className="border-b border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 sticky top-0 z-10">
      <div className="container mx-auto px-4">
        <nav className="flex gap-6 overflow-x-auto scrollbar-hide">
          {tabs.map((tab) => {
            const href = `/${locale}/channels/${channel.id}${tab.path}`;
            const isActive = pathname === href || (tab.path === '' && pathname === `/${locale}/channels/${channel.id}`);

            return (
              <button
                key={tab.id}
                onClick={() => router.push(href)}
                className={cn(
                  'py-4 px-2 border-b-2 font-medium text-sm whitespace-nowrap transition-colors',
                  isActive
                    ? 'border-blue-600 text-blue-600 dark:border-blue-500 dark:text-blue-500'
                    : 'border-transparent text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                )}
              >
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

interface Tab {
  id: string;
  label: string;
  path: string;
}

function getVisibleTabs(channel: Channel, t: ReturnType<typeof getTranslations>): Tab[] {
  const tabs: Tab[] = [
    { id: 'home', label: t.channel.home, path: '' },
  ];

  if ((channel.videosCount ?? 0) > 0) {
    tabs.push({ id: 'videos', label: t.video.videos, path: '/videos' });
  }

  if ((channel.shortsCount ?? 0) > 0) {
    tabs.push({ id: 'shorts', label: t.channel.shorts, path: '/shorts' });
  }

  if ((channel.liveStreamsCount ?? 0) > 0) {
    tabs.push({ id: 'live', label: t.channel.live, path: '/live' });
  }

  if ((channel.playlistsCount ?? 0) > 0) {
    tabs.push({ id: 'playlists', label: t.channel.playlists, path: '/playlists' });
  }

  if ((channel.subscribersCount ?? 0) >= 1000) {
    tabs.push({ id: 'community', label: t.community.community, path: '/community' });
  }

  tabs.push({ id: 'about', label: t.channel.about, path: '/about' });

  return tabs;
}
