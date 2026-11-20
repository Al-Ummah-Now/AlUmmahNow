'use client';

import React, { useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { ChannelSearch } from './ChannelSearch';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import type { ChannelTabConfig } from '@al-ummah/shared-types';
import { emptyTabs } from './emptyTabs';
import { PriorityStrip } from '@/components/ui/PriorityStrip';

export type ChannelTab =
  | 'home'
  | 'videos'
  | 'shorts'
  | 'live'
  | 'playlists'
  | 'community'
  | 'channels'
  | 'about';

interface ChannelTabBarProps {
  channelId: string;
  isOwner?: boolean;
  defaultTab?: ChannelTab;
  hiddenTabs?: ChannelTab[];
}

const DEFAULT_TABS: ChannelTab[] = [
  'home',
  'videos',
  'shorts',
  'live',
  'playlists',
  'community',
  'channels',
  'about',
];

export function ChannelTabBar({
  channelId,
  isOwner = false,
  defaultTab = 'home',
  hiddenTabs = [],
}: ChannelTabBarProps) {
  const { t, isRTL, locale } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [tabConfig, setTabConfig] = useState<ChannelTabConfig | null>(null);
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);

  // Fetch tab configuration from API on mount
  useEffect(() => {
    const fetchTabConfig = async () => {
      try {
        logger.debug('[ChannelTabBar] Fetching tab configuration', { channelId });
        const config = await getChannelTabConfig(channelId);
        setTabConfig(config);
        logger.debug('[ChannelTabBar] Tab configuration loaded', {
          channelId,
          defaultTab: config?.defaultTab,
          visibleCount: config?.tabs.filter(t => t.visible).length
        });
      } catch (error) {
        logger.error('[ChannelTabBar] Failed to fetch tab configuration', { channelId, error });
        // P2 fix: Better error messaging - log warning about fallback
        logger.warn('[ChannelTabBar] Using default tab configuration due to fetch failure', {
          channelId,
          error: error instanceof Error ? error.message : String(error)
        });
        // Fall back to default configuration
        setTabConfig(null);
      } finally {
        setIsLoadingConfig(false);
      }
    };

    fetchTabConfig();
  }, [channelId]);

  // Determine visible tabs from API config or fall back to props
  const visibleTabs: ChannelTab[] = React.useMemo(() => {
    // If still loading, show filtered tabs based on hiddenTabs to avoid flash
    if (isLoadingConfig) {
      return DEFAULT_TABS.filter(tab => !hiddenTabs.includes(tab));
    }

    if (tabConfig) {
      // Use API configuration, without the tabs that are empty for a visitor
      const empty = emptyTabs(tabConfig.counts, isOwner);
      return tabConfig.tabs
        .filter(tab => tab.visible && !(empty as string[]).includes(tab.id))
        .sort((a, b) => a.position - b.position)
        .map(tab => tab.id as ChannelTab);
    } else {
      // Fall back to prop-based configuration
      return DEFAULT_TABS.filter(tab => !hiddenTabs.includes(tab));
    }
  }, [tabConfig, hiddenTabs, isLoadingConfig, isOwner]);

  // Determine default tab from API config or fall back to props
  const effectiveDefaultTab: ChannelTab = React.useMemo(() => {
    if (tabConfig?.defaultTab) {
      return tabConfig.defaultTab as ChannelTab;
    }
    return defaultTab;
  }, [tabConfig, defaultTab]);

  // Get active tab from URL or use default
  const requestedTab = searchParams.get('tab') as ChannelTab;
  const activeTab = requestedTab || effectiveDefaultTab;

  // Redirect to default tab if requested tab is not visible/allowed
  useEffect(() => {
    if (!isLoadingConfig && requestedTab && !visibleTabs.includes(activeTab)) {
      logger.warn('[ChannelTabBar] Requested tab not visible, redirecting to default', {
        requestedTab,
        activeTab,
        visibleTabs,
        defaultTab: effectiveDefaultTab
      });

      // Remove invalid tab param and redirect to default
      const params = new URLSearchParams(searchParams);
      params.delete('tab');
      const queryString = params.toString();
      const newUrl = queryString ? `${pathname}?${queryString}` : pathname;
      router.replace(newUrl);
    }
  }, [isLoadingConfig, requestedTab, activeTab, visibleTabs, effectiveDefaultTab, pathname, searchParams, router]);

  const handleTabClick = (tab: ChannelTab) => {
    logger.debug('[ChannelTabBar] Tab clicked', { tab, channelId, activeTab });

    // Build new URL with tab parameter
    const params = new URLSearchParams(searchParams);
    if (tab === effectiveDefaultTab) {
      params.delete('tab');
    } else {
      params.set('tab', tab);
    }

    const queryString = params.toString();
    const newUrl = queryString ? `${pathname}?${queryString}` : pathname;

    router.push(newUrl);
  };

  const getTabLabel = (tab: ChannelTab): string => {
    // Try to get localized name from API config first (P2 fix: improved fallback logic)
    if (tabConfig) {
      const tabData = tabConfig.tabs.find(t => t.id === tab);
      if (tabData?.nameLocalized) {
        // Try current locale first, then fallback to 'en', then default name
        return tabData.nameLocalized[locale]
          || tabData.nameLocalized['en']
          || tabData.name;
      }
    }

    // Fall back to default i18n translations
    switch (tab) {
      case 'home': return t.channel.home;
      case 'videos': return t.channel.videos;
      case 'shorts': return t.channel.shorts;
      case 'live': return t.channel.live;
      case 'playlists': return t.channel.playlists;
      case 'community': return t.channel.community;
      case 'channels': return t.channel.channels;
      case 'about': return t.channel.about;
      default: return tab;
    }
  };

  // Show loading skeleton while fetching tab config (prevents flash when API returns different tabs)
  if (isLoadingConfig) {
    return (
      <div className="relative bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-5">
          <div className="flex items-center gap-2 overflow-hidden py-3">
            {/* Loading skeletons for tabs: one row, as the tabs */}
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-8 w-20 bg-gray-200 dark:bg-gray-700 rounded animate-pulse"
              />
            ))}
          </div>
        </div>
      </div>
    );
  }

  const items = visibleTabs.map((tab) => ({ id: tab, label: getTabLabel(tab), current: activeTab === tab }));

  return (
    <div className="relative bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
      <div className="max-w-6xl mx-auto px-5">
        <div className="relative flex items-center">
          {/* One row on every width: the tabs that fit, the rest under "More" at the row's end, the
              current tab always in the row (#1669: never a tab cut at the edge, never wrapped) */}
          <PriorityStrip
            items={items}
            testId="channel-tabs-strip"
            moreLabel={t.common.moreTabs}
            menuLabel={t.common.moreTabsMenu}
            moreClassName="tab-item tab-more"
            onSelect={(item) => handleTabClick(item.id as ChannelTab)}
            rowProps={{
              role: 'tablist',
              'data-testid': 'channel-tabs',
              dir: isRTL ? 'rtl' : 'ltr',
              className: 'tab-strip',
            }}
            renderItem={(item) => (
              <button
                key={item.id}
                type="button"
                role="tab"
                id={`tab-${item.id}`}
                data-testid={`tab-${item.id}`}
                aria-selected={item.current}
                aria-controls={`tabpanel-${item.id}`}
                onClick={() => handleTabClick(item.id as ChannelTab)}
                className="tab-item">
                {item.label}
              </button>
            )}
          />

          <div className="flex shrink-0 justify-end">
            <ChannelSearch channelId={channelId} />
          </div>
        </div>
      </div>
    </div>
  );
}
