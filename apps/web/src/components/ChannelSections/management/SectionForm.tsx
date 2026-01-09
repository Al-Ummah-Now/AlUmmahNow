'use client';

import { useState } from 'react';
import { ChannelSectionType, ChannelSectionCreateInput } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SectionFormProps {
  channelId: string;
  sectionType: ChannelSectionType;
  onSubmit: (data: ChannelSectionCreateInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
  initialData?: Partial<ChannelSectionCreateInput>;
}

const TITLE_REQUIRED_TYPES: ChannelSectionType[] = ['multiple_playlists'];
const PLAYLISTS_REQUIRED_TYPES: ChannelSectionType[] = ['single_playlist', 'multiple_playlists'];
const VIDEO_IDS_REQUIRED_TYPES: ChannelSectionType[] = ['featured_videos'];

export function SectionForm({
  sectionType,
  onSubmit,
  onCancel,
  isLoading = false,
  initialData,
}: SectionFormProps) {
  const [title, setTitle] = useState(initialData?.title || '');
  const [playlistIds, setPlaylistIds] = useState(
    initialData?.playlistIds?.join(', ') || initialData?.playlistId || ''
  );
  const [videoIds, setVideoIds] = useState(
    initialData?.videoIds?.join(', ') || ''
  );
  const [errors, setErrors] = useState<Record<string, string>>({});

  const needsTitle = TITLE_REQUIRED_TYPES.includes(sectionType);
  const needsPlaylists = PLAYLISTS_REQUIRED_TYPES.includes(sectionType);
  const needsVideoIds = VIDEO_IDS_REQUIRED_TYPES.includes(sectionType);

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
    } else if (sectionType === 'single_playlist') {
      const ids = playlistIds.split(',').map((id) => id.trim()).filter(Boolean);
      if (ids.length !== 1) {
        newErrors.playlists = 'Single playlist section requires exactly one playlist ID';
      }
    }

    // Video IDs validation
    if (needsVideoIds && !videoIds.trim()) {
      newErrors.videoIds = 'At least one video ID is required';
    }

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    if (!validate()) {
      return;
    }

    const data: ChannelSectionCreateInput = {
      type: sectionType,
      title: title.trim() || `${sectionType} section`,
    };

    if (needsPlaylists && playlistIds.trim()) {
      if (sectionType === 'single_playlist') {
        data.playlistId = playlistIds.trim();
      } else {
        data.playlistIds = playlistIds
          .split(',')
          .map((id) => id.trim())
          .filter(Boolean);
      }
    }

    if (needsVideoIds && videoIds.trim()) {
      data.videoIds = videoIds
        .split(',')
        .map((id) => id.trim())
        .filter(Boolean);
    }

    onSubmit(data);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Title input (for multiple_playlists and featured_videos) */}
      {(needsTitle || sectionType === 'single_playlist' || sectionType === 'featured_videos') && (
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
              sectionType === 'single_playlist'
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
            {sectionType === 'single_playlist'
              ? 'Enter exactly one playlist ID'
              : 'Separate multiple playlist IDs with commas'}
          </p>
        </div>
      )}

      {/* Video IDs picker (for featured_videos) */}
      {needsVideoIds && (
        <div>
          <label
            htmlFor="video-ids"
            className="
              block
              text-sm
              font-medium
              text-gray-900
              dark:text-gray-100
              mb-2
            "
          >
            Video IDs <span className="text-red-500">*</span>
          </label>
          <Input
            id="video-ids"
            type="text"
            value={videoIds}
            onChange={(e) => setVideoIds(e.target.value)}
            placeholder="Enter video IDs separated by commas"
            className={errors.videoIds ? 'border-red-500' : ''}
            aria-invalid={!!errors.videoIds}
            aria-describedby={errors.videoIds ? 'videoIds-error' : undefined}
          />
          {errors.videoIds && (
            <p id="videoIds-error" className="text-sm text-red-500 mt-1">
              {errors.videoIds}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            Separate multiple video IDs with commas (max 20)
          </p>
        </div>
      )}

      {/* Info message for automatic sections */}
      {!needsTitle && !needsPlaylists && !needsVideoIds && (
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
