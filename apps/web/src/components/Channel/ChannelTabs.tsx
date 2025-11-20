'use client';

import { usePathname, useRouter } from 'next/navigation';
import { useState, useEffect } from 'react';
import { Channel } from '@al-ummah/shared-types';
import { cn } from '@/lib/utils';
import { getTranslations } from '@/lib/i18n';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import { logger } from '@/lib/logger-client';

interface ChannelTabsProps {
  channel: Channel;
  locale: string;
}

export function ChannelTabs({ channel, locale }: ChannelTabsProps) {
  const router = useRouter();
  const pathname = usePathname();
  const t = getTranslations(locale as 'en' | 'ar');
  const [tabs, setTabs] = useState<Tab[]>(() => getDefaultTabs(channel, t));
  const [isLoading, setIsLoading] = useState(true);

  // Fetch tab configuration from API
  useEffect(() => {
    const fetchTabConfig = async () => {
      try {
        logger.info('[ChannelTabs] Fetching tab configuration', { channelId: channel.id });
        const config = await getChannelTabConfig(channel.id);

        if (config) {
          // Convert API config to tab format
          const apiTabs = config.tabs
            .filter(tab => tab.visible)
            .sort((a, b) => a.position - b.position)
            .map(tab => ({
              id: tab.id,
              label: tab.nameLocalized?.[locale] || tab.name,
              path: getTabPath(tab.id),
            }));

          setTabs(apiTabs);
          logger.info('[ChannelTabs] Tab configuration loaded', {
            channelId: channel.id,
            tabCount: apiTabs.length,
          });
        }
      } catch (error) {
        logger.error('[ChannelTabs] Failed to fetch tab configuration', {
          channelId: channel.id,
          error,
        });
        // Keep default tabs on error
      } finally {
        setIsLoading(false);
      }
    };

    fetchTabConfig();
  }, [channel.id, locale]);

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

// Map tab IDs to their URL paths
function getTabPath(tabId: string): string {
  switch (tabId) {
    case 'home': return '';
    case 'videos': return '/videos';
    case 'shorts': return '/shorts';
    case 'live': return '/live';
    case 'playlists': return '/playlists';
    case 'community': return '/community';
    case 'channels': return '/channels';
    case 'about': return '/about';
    default: return '';
  }
}

// Default tabs as fallback (shown while loading or on error)
function getDefaultTabs(channel: Channel, t: ReturnType<typeof getTranslations>): Tab[] {
  return [
    { id: 'home', label: t.channel.home, path: '' },
    { id: 'videos', label: t.video.videos, path: '/videos' },
    { id: 'shorts', label: t.channel.shorts, path: '/shorts' },
    { id: 'live', label: t.channel.live, path: '/live' },
    { id: 'playlists', label: t.channel.playlists, path: '/playlists' },
    { id: 'community', label: t.community.community, path: '/community' },
    { id: 'about', label: t.channel.about, path: '/about' },
  ];
}
