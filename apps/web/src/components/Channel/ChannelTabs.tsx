'use client';

import { usePathname, useRouter } from 'next/navigation';
import { Channel } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';

interface ChannelTabsProps {
  channel: Channel;
  locale: string;
}

export function ChannelTabs({ channel, locale }: ChannelTabsProps) {
  const router = useRouter();
  const pathname = usePathname();

  const tabs = getVisibleTabs(channel);

  return (
    <div className="border-b border-gray-200 bg-white sticky top-0 z-10">
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
                    ? 'border-blue-600 text-blue-600'
                    : 'border-transparent text-gray-600 hover:text-gray-900'
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

function getVisibleTabs(channel: Channel): Tab[] {
  const tabs: Tab[] = [
    { id: 'home', label: 'Home', path: '' },
  ];

  if ((channel.videosCount ?? 0) > 0) {
    tabs.push({ id: 'videos', label: 'Videos', path: '/videos' });
  }

  if ((channel.shortsCount ?? 0) > 0) {
    tabs.push({ id: 'shorts', label: 'Shorts', path: '/shorts' });
  }

  if ((channel.liveStreamsCount ?? 0) > 0) {
    tabs.push({ id: 'live', label: 'Live', path: '/live' });
  }

  if ((channel.playlistsCount ?? 0) > 0) {
    tabs.push({ id: 'playlists', label: 'Playlists', path: '/playlists' });
  }

  if ((channel.subscribersCount ?? 0) >= 1000) {
    tabs.push({ id: 'community', label: 'Community', path: '/community' });
  }

  tabs.push({ id: 'about', label: 'About', path: '/about' });

  return tabs;
}
