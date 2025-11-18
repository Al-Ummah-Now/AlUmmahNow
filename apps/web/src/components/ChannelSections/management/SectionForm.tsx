'use client';

import { useState } from 'react';
import { ChannelSectionType, ChannelSectionCreateRequest } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SectionFormProps {
  channelId: string;
  sectionType: ChannelSectionType;
  onSubmit: (data: ChannelSectionCreateRequest) => void;
  onCancel: () => void;
  isLoading?: boolean;
  initialData?: Partial<ChannelSectionCreateRequest>;
}

const TITLE_REQUIRED_TYPES: ChannelSectionType[] = ['multiplePlaylists', 'multipleChannels'];
const PLAYLISTS_REQUIRED_TYPES: ChannelSectionType[] = ['singlePlaylist', 'multiplePlaylists'];
const CHANNELS_REQUIRED_TYPES: ChannelSectionType[] = ['multipleChannels'];

export function SectionForm({
  sectionType,
  onSubmit,
  onCancel,
  isLoading = false,
  initialData,
}: SectionFormProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [playlistIds, setPlaylistIds] = useState(
    initialData?.playlists?.join(', ') || ''
  );
  const [channelIds, setChannelIds] = useState(
    initialData?.channels?.join(', ') || ''
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsTitle = TITLE_REQUIRED_TYPES.includes(sectionType);
  const needsPlaylists = PLAYLISTS_REQUIRED_TYPES.includes(sectionType);
  const needsChannels = CHANNELS_REQUIRED_TYPES.includes(sectionType);

  const validate = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Title validation
    if (needsTitle && !title.trim()) {
      newErrors.title = 'Title is required for this section type';
    } else if (title.length > 100) {
      newErrors.title = 'Title must be 100 characters or less';
    } else if (title.includes('<') || title.includes('>')) {
      newErrors.title = 'Title cannot contain < or > characters';
    }

    // Playlist validation
    if (needsPlaylists && !playlistIds.trim()) {
      newErrors.playlists = 'At least one playlist is required';
    } else if (sectionType === 'singlePlaylist') {
      const ids = playlistIds.split(',').map((id) => id.trim()).filter(Boolean);
      if (ids.length !== 1) {
        newErrors.playlists = 'Single playlist section requires exactly one playlist ID';
      }
    }

    // Channel validation
    if (needsChannels && !channelIds.trim()) {
      newErrors.channels = 'At least one channel is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const data: ChannelSectionCreateRequest = {
      type: sectionType,
    };

    if (needsTitle || title.trim()) {
      data.title = title.trim();
    }

    if (needsPlaylists && playlistIds.trim()) {
      data.playlists = playlistIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }

    if (needsChannels && channelIds.trim()) {
      data.channels = channelIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title input (for multiplePlaylists and multipleChannels) */}
      {(needsTitle || sectionType === 'singlePlaylist') && (
        <div>
          <label
            htmlFor="section-title"
            className="
              block
              text-sm
              font-medium
              text-gray-900
              dark:text-gray-100
              mb-2
            "
          >
            Section title {needsTitle && <span className="text-red-500">*</span>}
          </label>
          <Input
            id="section-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Enter section title"
            maxLength={100}
            className={errors.title ? 'border-red-500' : ''}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'title-error' : undefined}
          />
          {errors.title && (
            <p id="title-error" className="text-sm text-red-500 mt-1">
              {errors.title}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {title.length}/100 characters
          </p>
        </div>
      )}

      {/* Playlist picker (for singlePlaylist and multiplePlaylists) */}
      {needsPlaylists && (
        <div>
          <label
            htmlFor="playlist-ids"
            className="
              block
              text-sm
              font-medium
              text-gray-900
              dark:text-gray-100
              mb-2
            "
          >
            Playlist IDs <span className="text-red-500">*</span>
          </label>
          <Input
            id="playlist-ids"
            type="text"
            value={playlistIds}
            onChange={(e) => setPlaylistIds(e.target.value)}
            placeholder={
              sectionType === 'singlePlaylist'
                ? 'Enter one playlist ID'
                : 'Enter playlist IDs separated by commas'
            }
            className={errors.playlists ? 'border-red-500' : ''}
            aria-invalid={!!errors.playlists}
            aria-describedby={errors.playlists ? 'playlists-error' : undefined}
          />
          {errors.playlists && (
            <p id="playlists-error" className="text-sm text-red-500 mt-1">
              {errors.playlists}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {sectionType === 'singlePlaylist'
              ? 'Enter exactly one playlist ID'
              : 'Separate multiple playlist IDs with commas'}
          </p>
        </div>
      )}

      {/* Channel picker (for multipleChannels) */}
      {needsChannels && (
        <div>
          <label
            htmlFor="channel-ids"
            className="
              block
              text-sm
              font-medium
              text-gray-900
              dark:text-gray-100
              mb-2
            "
          >
            Channel IDs <span className="text-red-500">*</span>
          </label>
          <Input
            id="channel-ids"
            type="text"
            value={channelIds}
            onChange={(e) => setChannelIds(e.target.value)}
            placeholder="Enter channel IDs separated by commas"
            className={errors.channels ? 'border-red-500' : ''}
            aria-invalid={!!errors.channels}
            aria-describedby={errors.channels ? 'channels-error' : undefined}
          />
          {errors.channels && (
            <p id="channels-error" className="text-sm text-red-500 mt-1">
              {errors.channels}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Separate multiple channel IDs with commas
          </p>
        </div>
      )}

      {/* Info message for automatic sections */}
      {!needsTitle && !needsPlaylists && !needsChannels && (
        <div className="
          p-3
          bg-blue-50
          dark:bg-blue-900/20
          border
          border-blue-200
          dark:border-blue-800
          rounded-lg
        ">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            This section type will automatically display content from your channel.
            No additional configuration is needed.
          </p>
        </div>
      )}

      {/* Form actions */}
      <div className="
        flex
        flex-col-reverse    /* Mobile: stack buttons */
        sm:flex-row         /* Tablet+: row */
        gap-2
        sm:gap-3
        pt-2
      ">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="
            w-full            /* Mobile: full width */
            sm:w-auto         /* Tablet+: auto width */
          "
        >
          Cancel
        </Button>
        <Button
          type="submit"
          disabled={isLoading}
          className="
            w-full            /* Mobile: full width */
            sm:w-auto         /* Tablet+: auto width */
            sm:ml-auto        /* Push to right on desktop */
          "
        >
          {isLoading ? 'Creating...' : 'Create section'}
        </Button>
      </div>
    </form>
  );
}
