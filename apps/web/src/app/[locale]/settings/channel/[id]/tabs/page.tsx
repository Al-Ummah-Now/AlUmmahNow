'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { ChannelTabConfig } from '@al-ummah/shared-types';
import TabManagement from '@/components/TabManagement';
import { Button } from '@/components/ui/button';
import { getChannelTabConfig, updateChannelTabConfig, verifyChannelOwnership } from '@/lib/api/channel-tabs';
import { getChannelById } from '@/lib/api/channels';
import { useLanguage } from '@/hooks/useLanguage';
import { logger } from '@/lib/logger-client';
import { ArrowLeft, Eye } from 'lucide-react';

export default function ChannelTabsSettingsPage() {
  const params = useParams();
  const router = useRouter();
  const { t } = useLanguage();
  const channelId = params.id as string;
  const locale = (params.locale as string) || 'en';

  const [config, setConfig] = useState<ChannelTabConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [isOwner, setIsOwner] = useState(false);

  // Fetch tab configuration and verify ownership
  useEffect(() => {
    async function fetchData() {
      setLoading(true);
      setError(null);

      try {
        logger.info('ChannelTabsSettings: Fetching tab configuration', {
          channelId,
        });

        // Verify channel exists
        const channel = await getChannelById(channelId);
        if (!channel) {
          setError(t.channel.channelNotFound);
          setLoading(false);
          return;
        }

        // Verify ownership (P1 fix)
        const isChannelOwner = await verifyChannelOwnership(channelId);
        setIsOwner(isChannelOwner);

        if (!isChannelOwner) {
          logger.warn('ChannelTabsSettings: User is not channel owner', {
            channelId,
          });
          setLoading(false);
          return;
        }

        // Fetch tab configuration
        const tabConfig = await getChannelTabConfig(channelId);

        if (tabConfig) {
          logger.info('ChannelTabsSettings: Tab configuration loaded', {
            channelId,
            defaultTab: tabConfig.defaultTab,
            tabsCount: tabConfig.tabs.length,
          });
          setConfig(tabConfig);
        } else {
          setError(t.errors.genericError);
        }
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : String(err);
        logger.error('ChannelTabsSettings: Error fetching tab configuration', {
          error: err,
          errorMessage,
          channelId,
        });
        setError(t.errors.networkError);
      } finally {
        setLoading(false);
      }
    }

    fetchData();
  }, [channelId, t]);

  // Handle save
  const handleSave = async (data: {
    defaultTab: string;
    tabs: Array<{ id: string; visible: boolean; position: number }>;
  }): Promise<boolean> => {
    try {
      logger.info('ChannelTabsSettings: Saving tab configuration', {
        channelId,
        defaultTab: data.defaultTab,
        tabsCount: data.tabs.length,
      });

      const result = await updateChannelTabConfig(channelId, data);

      if (result) {
        setConfig(result);
        logger.info('ChannelTabsSettings: Tab configuration saved successfully', {
          channelId,
        });
        return true;
      }

      return false;
    } catch (err) {
      logger.error('ChannelTabsSettings: Error saving tab configuration', {
        error: err,
        channelId,
      });
      return false;
    }
  };

  // Loading state
  if (loading) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-8 bg-gray-200 dark:bg-gray-700 rounded w-48"></div>
          <div className="h-4 bg-gray-200 dark:bg-gray-700 rounded w-64"></div>
          <div className="space-y-3">
            {[1, 2, 3, 4, 5].map((i) => (
              <div
                key={i}
                className="h-16 bg-gray-200 dark:bg-gray-700 rounded"
              ></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  // Error state
  if (error || !config) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <div className="p-6 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <h2 className="text-lg font-semibold text-red-900 dark:text-red-200 mb-2">
            {t.common.error}
          </h2>
          <p className="text-red-700 dark:text-red-300">{error}</p>
          <Button
            onClick={() => router.back()}
            variant="outline"
            className="mt-4"
          >
            {t.common.back}
          </Button>
        </div>
      </div>
    );
  }

  // Not owner
  if (!isOwner) {
    return (
      <div className="max-w-4xl mx-auto p-4 md:p-6">
        <div className="p-6 bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg">
          <h2 className="text-lg font-semibold text-yellow-900 dark:text-yellow-200 mb-2">
            {t.errors.unauthorized}
          </h2>
          <p className="text-yellow-700 dark:text-yellow-300">
            {t.errors.forbidden}
          </p>
          <Button
            onClick={() => router.back()}
            variant="outline"
            className="mt-4"
          >
            {t.common.back}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-4 md:p-6 space-y-4 md:space-y-6">
      {/* Navigation Bar */}
      <div className="flex items-center justify-between pb-4 border-b border-gray-200 dark:border-gray-700">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className="flex items-center gap-2 text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-100"
        >
          <ArrowLeft className="w-4 h-4" />
          <span className="hidden sm:inline">{t.common.back}</span>
        </Button>

        <Link
          href={`/${locale}/channels/${channelId}`}
          className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors"
        >
          <Eye className="w-4 h-4" />
          <span>{t.header.viewChannel}</span>
        </Link>
      </div>

      {/* Header */}
      <div>
        <h1 className="text-xl md:text-2xl font-bold text-gray-900 dark:text-gray-100">
          {t.channel.tabs.manage_tabs}
        </h1>
        <p className="text-sm md:text-base text-gray-600 dark:text-gray-400 mt-1">
          {t.channel.tabs.manage_tabs_description}
        </p>
      </div>

      {/* Tab Management Component */}
      <TabManagement
        channelId={channelId}
        initialConfig={config}
        onSave={handleSave}
      />
    </div>
  );
}
