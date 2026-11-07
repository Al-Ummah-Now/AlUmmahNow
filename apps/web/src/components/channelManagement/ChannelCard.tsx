import React, { useState } from 'react';
import { DeleteChannelDialog } from '@/components/channelManagement/DeleteChannelDialog';
import { ChannelCardProps } from './types';
import { Button } from '@/components/ui/button';
import { useLanguage } from '@/hooks/useLanguage';
import { getLocalizedValue } from '@al-ummah/shared-types';

/**
 * ChannelCard Component
 * Displays individual channel information with actions (edit, delete, view)
 */
export const ChannelCard: React.FC<ChannelCardProps> = ({
  channel,
  onEdit,
  onDelete,
  onView,
}) => {
  const { t, dir, lang } = useLanguage();
  const [deleteOpen, setDeleteOpen] = useState(false);

  const name = getLocalizedValue(channel.nameLocalized, channel.name, lang);
  const description = getLocalizedValue(channel.descriptionLocalized, channel.description, lang);

  // Opens the shared confirmation dialog (type-the-name, main-channel handling)
  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleteOpen(true);
  };

  const handleEdit = (e: React.MouseEvent) => {
    e.stopPropagation();
    onEdit(channel);
  };

  const handleView = () => {
    onView(channel.id);
  };

  return (
    <div
      className="bg-white dark:bg-gray-800 rounded-lg shadow-md hover:shadow-lg transition-shadow duration-200 overflow-hidden cursor-pointer"
      onClick={handleView}
      dir={dir}
    >
      {/* Channel Avatar/Cover */}
      <div
        className="h-32 bg-gradient-to-br from-blue-500 to-purple-600 dark:from-blue-700 dark:to-purple-800 flex items-center justify-center"
        style={{
          backgroundImage: channel.coverUrl ? `url(${channel.coverUrl})` : undefined,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
        }}
      >
        {!channel.coverUrl && (
          <div
            className="w-16 h-16 rounded-full bg-white dark:bg-gray-700 flex items-center justify-center text-2xl font-bold text-gray-800 dark:text-white"
            style={{
              backgroundImage: channel.avatarUrl ? `url(${channel.avatarUrl})` : undefined,
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          >
            {!channel.avatarUrl && name.charAt(0).toUpperCase()}
          </div>
        )}
      </div>

      {/* Channel Info */}
      <div className="p-4">
        <div className="flex items-start justify-between mb-2">
          <div className="flex-1 min-w-0">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-white truncate">
              {name}
              {channel.isVerified && (
                <svg
                  className="inline-block ml-1 w-4 h-4 text-blue-500"
                  fill="currentColor"
                  viewBox="0 0 20 20"
                >
                  <path
                    fillRule="evenodd"
                    d="M6.267 3.455a3.066 3.066 0 001.745-.723 3.066 3.066 0 013.976 0 3.066 3.066 0 001.745.723 3.066 3.066 0 012.812 2.812c.051.643.304 1.254.723 1.745a3.066 3.066 0 010 3.976 3.066 3.066 0 00-.723 1.745 3.066 3.066 0 01-2.812 2.812 3.066 3.066 0 00-1.745.723 3.066 3.066 0 01-3.976 0 3.066 3.066 0 00-1.745-.723 3.066 3.066 0 01-2.812-2.812 3.066 3.066 0 00-.723-1.745 3.066 3.066 0 010-3.976 3.066 3.066 0 00.723-1.745 3.066 3.066 0 012.812-2.812zm7.44 5.252a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                    clipRule="evenodd"
                  />
                </svg>
              )}
            </h3>
            {channel.isMain && (
              <span className="inline-block px-2 py-1 text-xs font-medium bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 rounded">
                {t.channel.mainChannel}
              </span>
            )}
          </div>
        </div>

        {description && (
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-3 line-clamp-2">
            {description}
          </p>
        )}

        {/* Stats */}
        <div className="flex items-center gap-4 text-sm text-gray-600 dark:text-gray-400 mb-4">
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M9 6a3 3 0 11-6 0 3 3 0 016 0zM17 6a3 3 0 11-6 0 3 3 0 016 0zM12.93 17c.046-.327.07-.66.07-1a6.97 6.97 0 00-1.5-4.33A5 5 0 0119 16v1h-6.07zM6 11a5 5 0 015 5v1H1v-1a5 5 0 015-5z" />
            </svg>
            <span>{channel.subscribersCount?.toLocaleString() || 0}</span>
          </div>
          <div className="flex items-center gap-1">
            <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
              <path d="M2 6a2 2 0 012-2h6a2 2 0 012 2v8a2 2 0 01-2 2H4a2 2 0 01-2-2V6zM14.553 7.106A1 1 0 0014 8v4a1 1 0 00.553.894l2 1A1 1 0 0018 13V7a1 1 0 00-1.447-.894l-2 1z" />
            </svg>
            <span>{channel.videosCount?.toLocaleString() || 0}</span>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleView}
            className="flex-1"
          >
            {lang === 'ar' ? 'عرض' : 'View'}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={handleEdit}
            aria-label={`${t.common.edit}: ${name}`}
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"
              />
            </svg>
          </Button>
          <Button
            variant="destructive"
            size="sm"
            onClick={handleDelete}
            title={t.channel.deleteChannel}
            aria-label={`${t.channel.deleteChannel}: ${name}`}
            data-testid="channel-card-delete"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"
              />
            </svg>
          </Button>
        </div>
      </div>

      {/* Delete confirmation (shared dialog); clicks inside must not open the channel */}
      <div onClick={(e) => e.stopPropagation()}>
        <DeleteChannelDialog
          channel={{ id: channel.id, name: channel.name, nameLocalized: channel.nameLocalized, isMain: channel.isMain }}
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onDeleted={() => onDelete(channel.id)}
        />
      </div>
    </div>
  );
};
