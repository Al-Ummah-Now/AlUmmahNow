'use client';

import React, { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { Channel } from '@al-ummah/shared-types';
import { useAuth } from '@/components/AuthProvider/authContext';
import { useChannels } from '@/hooks/useChannels';
import { useI18n } from '@/lib/i18n';
import { ChannelManagementSectionProps, CreateChannelFormData } from './types';
import { ChannelGrid } from './ChannelGrid';
import { CreateChannelDialog } from './CreateChannelDialog';

/**
 * ChannelManagementSection Component (LTR)
 * Main component for managing user channels
 * Features:
 * - Display user's channels in a responsive grid
 * - Create new channels via dialog
 * - Edit, delete, and view channels
 * - Loading and error states
 */
export const ChannelManagementSection: React.FC<ChannelManagementSectionProps> = ({
  className = '',
}) => {
  const router = useRouter();
  const pathname = usePathname();
  const locale = pathname?.startsWith('/ar') ? 'ar' : 'en';
  const { t, dir } = useI18n(locale);
  const auth = useAuth();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [toastMessage, setToastMessage] = useState<string | null>(null);

  // Get userId from auth
  const userId = auth?.user?.id;

  // For channelId, we'll use the first channel's ID or empty string
  // The API will return user's channels based on userId
  const channelId = userId || '';

  const {
    channels,
    isLoading,
    error,
    createChannel,
    deleteChannel,
  } = useChannels({
    channelId,
    userId,
    autoFetch: true,
  });

  // Show toast message
  const showToast = (message: string) => {
    setToastMessage(message);
    setTimeout(() => setToastMessage(null), 3000);
  };

  // Handle create channel
  const handleCreateChannel = async (data: CreateChannelFormData) => {
    console.log('ChannelManagementSection: Creating channel with data:', data);

    const success = await createChannel({
      name: data.name,
      description: data.description,
    });

    if (success) {
      showToast(t.success.created);
      setDialogOpen(false);
    } else {
      showToast(t.errors.genericError);
    }
  };

  // Handle edit channel
  const handleEditChannel = (channel: Channel) => {
    console.log('ChannelManagementSection: Edit channel:', channel);
    // Navigate to channel edit page
    router.push(`/${locale}/channel/${channel.id}/edit`);
  };

  // Handle delete channel
  const handleDeleteChannel = async (channelId: string) => {
    console.log('ChannelManagementSection: Delete channel:', channelId);

    const success = await deleteChannel(channelId);

    if (success) {
      showToast(t.success.deleted);
    } else {
      showToast(t.errors.genericError);
    }
  };

  // Handle view channel
  const handleViewChannel = (channelId: string) => {
    console.log('ChannelManagementSection: View channel:', channelId);
    // Navigate to channel page
    router.push(`/${locale}/channel/${channelId}`);
  };

  return (
    <section id="channels" className={`section mb-8 ${className}`} dir={dir}>
      {/* Section Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-semibold text-gray-800 dark:text-white">
            {t.channel.myChannels}
          </h2>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            {t.channel.manageChannels}
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
            {t.channel.createChannel}
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
      <ChannelGrid
        channels={channels}
        onEdit={handleEditChannel}
        onDelete={handleDeleteChannel}
        onView={handleViewChannel}
        onCreate={() => setDialogOpen(true)}
        isLoading={isLoading}
        lang={locale}
      />

      {/* Create Channel Dialog */}
      <CreateChannelDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        onSubmit={handleCreateChannel}
        isLoading={isLoading}
        lang={locale}
      />

      {/* Toast Message */}
      {toastMessage && (
        <div className="fixed bottom-4 right-4 z-50 animate-in slide-in-from-bottom-5">
          <div className="bg-gray-900 dark:bg-gray-800 text-white px-6 py-3 rounded-lg shadow-lg border border-gray-700">
            <p className="text-sm font-medium">{toastMessage}</p>
          </div>
        </div>
      )}
    </section>
  );
};
