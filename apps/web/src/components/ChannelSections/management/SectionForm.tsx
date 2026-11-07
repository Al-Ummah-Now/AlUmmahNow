'use client';

import { useState } from 'react';
import { ChannelSectionType, ChannelSectionCreateInput } from '@al-ummah/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useLanguage } from '@/hooks/useLanguage';

interface SectionFormProps {
  channelId: string;
  sectionType: ChannelSectionType;
  onSubmit: (data: ChannelSectionCreateInput) => void;
  onCancel: () => void;
  isLoading?: boolean;
  initialData?: Partial<ChannelSectionCreateInput>;
  /** 'create' (default) shows "Create section"; 'edit' shows "Save changes" */
  mode?: 'create' | 'edit';
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
  mode = 'create',
}: SectionFormProps) {
  const { t, isRTL } = useLanguage();
  const s = t.channelManage.sections;
  const f = s.form;
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

    if (needsTitle && !title.trim()) {
      newErrors.title = f.titleRequired;
    } else if (title.length > 100) {
      newErrors.title = f.titleTooLong;
    } else if (title.includes('<') || title.includes('>')) {
      newErrors.title = f.titleInvalidChars;
    }

    if (needsPlaylists && !playlistIds.trim()) {
      newErrors.playlists = f.playlistRequired;
    } else if (sectionType === 'single_playlist') {
      const ids = playlistIds.split(',').map((id) => id.trim()).filter(Boolean);
      if (ids.length !== 1) {
        newErrors.playlists = f.singlePlaylistOnly;
      }
    }

    if (needsVideoIds && !videoIds.trim()) {
      newErrors.videoIds = f.videoRequired;
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
      // Untitled sections are named after their (localized) type
      title: title.trim() || s.typeLabels[sectionType] || sectionType,
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

  const submitLabel = mode === 'edit'
    ? (isLoading ? f.saving : f.saveSection)
    : (isLoading ? f.creating : f.createSection);

  return (
    <form onSubmit={handleSubmit} className="space-y-4" dir={isRTL ? 'rtl' : 'ltr'} noValidate>
      {/* Every section type has an editable title (automatic ones too) */}
      <div>
          <label
            htmlFor="section-title"
            className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2"
          >
            {f.sectionTitle} {needsTitle && <span className="text-red-500">*</span>}
          </label>
          <Input
            id="section-title"
            type="text"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={f.enterSectionTitle}
            maxLength={100}
            className={errors.title ? 'border-red-500' : ''}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'title-error' : undefined}
          />
          {errors.title && (
            <p id="title-error" role="alert" className="text-sm text-red-500 mt-1">
              {errors.title}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {f.charactersCount.replace('{count}', String(title.length))}
          </p>
      </div>

      {needsPlaylists && (
        <div>
          <label
            htmlFor="playlist-ids"
            className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2"
          >
            {f.playlistIds} <span className="text-red-500">*</span>
          </label>
          <Input
            id="playlist-ids"
            type="text"
            dir="ltr"
            value={playlistIds}
            onChange={(e) => setPlaylistIds(e.target.value)}
            placeholder={sectionType === 'single_playlist' ? f.enterOnePlaylistId : f.enterPlaylistIds}
            className={errors.playlists ? 'border-red-500' : ''}
            aria-invalid={!!errors.playlists}
            aria-describedby={errors.playlists ? 'playlists-error' : undefined}
          />
          {errors.playlists && (
            <p id="playlists-error" role="alert" className="text-sm text-red-500 mt-1">
              {errors.playlists}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {sectionType === 'single_playlist' ? f.enterExactlyOnePlaylistId : f.separatePlaylistIds}
          </p>
        </div>
      )}

      {needsVideoIds && (
        <div>
          <label
            htmlFor="video-ids"
            className="block text-sm font-medium text-gray-900 dark:text-gray-100 mb-2"
          >
            {f.videoIds} <span className="text-red-500">*</span>
          </label>
          <Input
            id="video-ids"
            type="text"
            dir="ltr"
            value={videoIds}
            onChange={(e) => setVideoIds(e.target.value)}
            placeholder={f.enterVideoIds}
            className={errors.videoIds ? 'border-red-500' : ''}
            aria-invalid={!!errors.videoIds}
            aria-describedby={errors.videoIds ? 'videoIds-error' : undefined}
          />
          {errors.videoIds && (
            <p id="videoIds-error" role="alert" className="text-sm text-red-500 mt-1">
              {errors.videoIds}
            </p>
          )}
          <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
            {f.separateVideoIds}
          </p>
        </div>
      )}

      {!needsTitle && !needsPlaylists && !needsVideoIds && (
        <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
          <p className="text-sm text-blue-800 dark:text-blue-300">
            {f.automaticMessage}
          </p>
        </div>
      )}

      <div className="flex flex-col-reverse sm:flex-row gap-2 sm:gap-3 pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={onCancel}
          disabled={isLoading}
          className="w-full sm:w-auto"
        >
          {f.cancel}
        </Button>
        <Button
          type="submit"
          disabled={isLoading}
          className="w-full sm:w-auto sm:ms-auto"
        >
          {submitLabel}
        </Button>
      </div>
    </form>
  );
}
