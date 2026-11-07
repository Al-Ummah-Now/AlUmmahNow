import { logger } from '@/lib/logger-client';

import React, { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { CHANNEL_DELETED_PARAM } from '@/components/channelManagement/DeleteChannelDialog';
import { Channel } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useChannels } from '@/hooks/useChannels';
import { ChannelManagementSectionProps, CreateChannelFormData } from '../types';
import { ChannelGridRTL } from './ChannelGrid';
import { CreateChannelDialog } from '../CreateChannelDialog';
import { useLanguage } from '@/hooks/useLanguage';

/**
 * ChannelManagementSection Component (RTL - Arabic)
 * Main component for managing user channels in Arabic
 * Features:
 * - Display user's channels in a responsive grid
 * - Create new channels via dialog
 * - Edit, delete, and view channels
 * - Loading and error states
 * - Full RTL layout support
 */
export const ChannelManagementSection: React.FC<ChannelManagementSectionProps> = ({
  className = '',
}) => {
  const router = useRouter();
  const { user } = useAuth();
  const { t } = useLanguage();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Get userId from auth - use user's first channel or empty string
  // The API will return user's channels based on the authenticated user
  const userId = user?.id || '';
  const channelId = userId;

  const {
    channels,
    isLoading,
    error,
    createChannel,
    refetch,
  } = useChannels({
    channelId,
    autoFetch: true,
  });

  // Show toast message
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Success notice after deleting a channel (DeleteChannelDialog redirects here)
  const searchParams = useSearchParams();
  const deletedNotice = searchParams?.get(CHANNEL_DELETED_PARAM);
  useEffect(() => {
    if (!deletedNotice) return;
    setToastMessage(t.channel.deleteSuccess);
    const timer = setTimeout(() => setToastMessage(null), 4000);
    return () => clearTimeout(timer);
  }, [deletedNotice, t.channel.deleteSuccess]);

  // Handle create channel
  const handleCreateChannel = async (data: CreateChannelFormData) => {
    logger.debug('ChannelManagementSection (RTL): Creating channel with data:', data);

    const success = await createChannel({
      name: data.name,
      description: data.description,
    });

    if (success) {
      showToast('تم إنشاء القناة بنجاح!');
      setDialogOpen(false);
    } else {
      showToast('فشل إنشاء القناة. يرجى المحاولة مرة أخرى.');
    }
  };

  // Handle edit channel
  const handleEditChannel = (channel: Channel) => {
    logger.debug('ChannelManagementSection (RTL): Edit channel:', channel);
    // Navigate to channel edit page (Arabic route)
    router.push(`/ar/settings/channel/${channel.id}/edit`);
  };

  // Called after DeleteChannelDialog deleted the channel: refresh the list
  const handleDeleteChannel = async (channelId: string) => {
    logger.debug('ChannelManagementSection: Channel deleted:', channelId);
    await refetch();
  };

  // Handle view channel
  const handleViewChannel = (channelId: string) => {
    logger.debug('ChannelManagementSection (RTL): View channel:', channelId);
    // Navigate to channel page (Arabic route)
    router.push(`/ar/channels/${channelId}`);
  };

  return (
    <section id="channels" className={`section mb-8 ${className}`} dir="rtl">
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            قنواتي
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            إدارة قنواتك ومحتواك
          </p>
        </div>
        {channels.length > 0 && (
          <button
            onClick={() => setDialogOpen(true)}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            قناة جديدة
          </button>
        )}
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-6 p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg">
          <div className="flex items-center gap-2">
            <svg
              className="w-5 h-5 text-red-600 dark:text-red-400"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            <p className="text-red-600 dark:text-red-400">{error}</p>
          </div>
        </div>
      )}

      {/* Channel Grid */}
      <ChannelGridRTL
        channels={channels}
        onEdit={handleEditChannel}
        onDelete={handleDeleteChannel}
        onView={handleViewChannel}
        onCreate={() => setDialogOpen(true)}
        isLoading={isLoading}
      />

      {/* Create Channel Dialog */}
      <CreateChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreateChannel}
        isLoading={isLoading}
        lang="ar"
      />

      {/* Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-4 end-4 z-50 animate-in slide-in-from-bottom-5" role="status" data-testid="channel-toast">
          <div className="bg-gray-900 dark:bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg border border-gray-700">
            <p className="text-sm font-medium">{toastMessage}</p>
          </div>
        </div>
      )}
    </section>
  );
};
