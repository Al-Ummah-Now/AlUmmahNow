'use client';

import React, { useRef, useEffect, useState } from 'react';
import { useSearchParams, useRouter, usePathname } from 'next/navigation';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { getChannelTabConfig } from '@/lib/api/channel-tabs';
import type { ChannelTabConfig } from '@al-ummah/shared-types';

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
  defaultTab = 'home',
  hiddenTabs = [],
}: ChannelTabBarProps) {
  const { t, locale } = useLanguage();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const tabBarRef = useRef<HTMLDivElement>(null);
  const [showLeftScroll, setShowLeftScroll] = useState(false);
  const [showRightScroll, setShowRightScroll] = useState(false);
  const [tabConfig, setTabConfig] = useState<ChannelTabConfig | null>(null);

  // Fetch tab configuration from API on mount
  useEffect(() => {
    const fetchTabConfig = async () => {
      try {
        logger.info('[ChannelTabBar:RTL] Fetching tab configuration', { channelId });
        const config = await getChannelTabConfig(channelId);
        setTabConfig(config);
        logger.info('[ChannelTabBar:RTL] Tab configuration loaded', {
          channelId,
          defaultTab: config?.defaultTab,
          visibleCount: config?.tabs.filter(t => t.visible).length
        });
      } catch (error) {
        logger.error('[ChannelTabBar:RTL] Failed to fetch tab configuration', { channelId, error });
        // P2 fix: Better error messaging - log warning about fallback
        logger.warn('[ChannelTabBar:RTL] Using default tab configuration due to fetch failure', {
          channelId,
          error: error instanceof Error ? error.message : String(error)
        });
        // Fall back to default configuration
        setTabConfig(null);
      }
    };

    fetchTabConfig();
  }, [channelId]);

  // Determine visible tabs from API config or fall back to props
  const visibleTabs: ChannelTab[] = React.useMemo(() => {
    if (tabConfig) {
      // Use API configuration
      return tabConfig.tabs
        .filter(tab => tab.visible)
        .sort((a, b) => a.position - b.position)
        .map(tab => tab.id as ChannelTab);
    } else {
      // Fall back to prop-based configuration
      return DEFAULT_TABS.filter(tab => !hiddenTabs.includes(tab));
    }
  }, [tabConfig, hiddenTabs]);

  // Determine default tab from API config or fall back to props
  const effectiveDefaultTab: ChannelTab = React.useMemo(() => {
    if (tabConfig?.defaultTab) {
      return tabConfig.defaultTab as ChannelTab;
    }
    return defaultTab;
  }, [tabConfig, defaultTab]);

  // Get active tab from URL or use default
  const activeTab = (searchParams.get('tab') as ChannelTab) || effectiveDefaultTab;

  // Check if scroll buttons should be shown (RTL-aware)
  useEffect(() => {
    const checkScroll = () => {
      const el = tabBarRef.current;
      if (!el) return;

      const hasOverflow = el.scrollWidth > el.clientWidth;
      // For RTL, scrollLeft is typically negative or zero
      const scrollLeft = Math.abs(el.scrollLeft);
      const maxScroll = el.scrollWidth - el.clientWidth;

      // In RTL, left button scrolls to the right side
      setShowLeftScroll(hasOverflow && scrollLeft < maxScroll - 5);
      setShowRightScroll(hasOverflow && scrollLeft > 5);
    };

    checkScroll();
    const el = tabBarRef.current;
    el?.addEventListener('scroll', checkScroll);
    window.addEventListener('resize', checkScroll);

    return () => {
      el?.removeEventListener('scroll', checkScroll);
      window.removeEventListener('resize', checkScroll);
    };
  }, []);

  const handleTabClick = (tab: ChannelTab) => {
    logger.info('[ChannelTabBar:RTL] Tab clicked', { tab, channelId, activeTab });

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

  const scroll = (direction: 'left' | 'right') => {
    const el = tabBarRef.current;
    if (!el) return;

    const scrollAmount = 200;
    // In RTL, left means scroll right (more positive) and right means scroll left (more negative)
    const targetScroll = direction === 'left'
      ? el.scrollLeft + scrollAmount
      : el.scrollLeft - scrollAmount;

    el.scrollTo({
      left: targetScroll,
      behavior: 'smooth',
    });
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

  return (
    <div className="relative bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700" dir="rtl">
      <div className="max-w-6xl mx-auto px-5">
        <div className="relative flex items-center">
          {/* Right scroll button (visually on right, scrolls to right content) */}
          {showRightScroll && (
            <button
              type="button"
              onClick={() => scroll('right')}
              className="absolute right-0 z-10 h-12 w-8 flex items-center justify-center bg-gradient-to-l from-white dark:from-gray-800 to-transparent"
              aria-label="انتقل إلى اليسار"
            >
              <svg
                className="w-5 h-5 text-gray-600 dark:text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15 19l-7-7 7-7"
                />
              </svg>
            </button>
          )}

          {/* Tab bar */}
          <div
            ref={tabBarRef}
            role="tablist"
            data-testid="channel-tabs"
            dir="rtl"
            className="flex overflow-x-auto scrollbar-hide scroll-smooth"
            style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
          >
            {visibleTabs.map((tab) => (
              <button
                key={tab}
                type="button"
                role="tab"
                id={`tab-${tab}`}
                data-testid={`tab-${tab}`}
                aria-selected={activeTab === tab}
                aria-controls={`tabpanel-${tab}`}
                onClick={() => handleTabClick(tab)}
                className="tab-item"
              >
                {getTabLabel(tab)}
              </button>
            ))}
          </div>

          {/* Left scroll button (visually on left, scrolls to left content) */}
          {showLeftScroll && (
            <button
              type="button"
              onClick={() => scroll('left')}
              className="absolute left-0 z-10 h-12 w-8 flex items-center justify-center bg-gradient-to-r from-white dark:from-gray-800 to-transparent"
              aria-label="انتقل إلى اليمين"
            >
              <svg
                className="w-5 h-5 text-gray-600 dark:text-gray-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 5l7 7-7 7"
                />
              </svg>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
