'use client';

import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Trash2, Star, StarOff, Languages, FileText, Calendar, HardDrive, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  listSubtitles,
  deleteSubtitle,
  setDefaultSubtitle,
  SubtitleTrack,
  SUPPORTED_LANGUAGES,
} from '@/lib/api/subtitles';
import SubtitleUploadModal from './SubtitleUploadModal';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '@/components/ui/alert-dialog';

interface SubtitleUploadSectionProps {
  videoId: string;
  channelId: string;
  className?: string;
}

/**
 * SubtitleUploadSection Component
 *
 * Manages subtitle tracks for a video in the video edit page:
 * - Lists all uploaded subtitle tracks
 * - Shows language, status, size, upload date, default indicator
 * - Actions: Set as default, Delete
 * - "Add Subtitle" button to open upload modal
 * - Empty state when no subtitles
 *
 * Mobile-first responsive design with full accessibility.
 */
export default function SubtitleUploadSection({
  videoId,
  channelId,
  className = '',
}: SubtitleUploadSectionProps) {
  const { t, lang } = useLanguage();

  // State
  const [subtitles, setSubtitles] = useState<SubtitleTrack[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<SubtitleTrack | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadSubtitles = useCallback(async () => {
    setIsLoading(true);
    try {
      const tracks = await listSubtitles(videoId, {  channelId });
      setSubtitles(tracks);
    } catch (error) {
      console.error('Failed to load subtitles:', error);
    } finally {
      setIsLoading(false);
    }
  }, [videoId, channelId]);

  // Load subtitles on mount
  useEffect(() => {
    loadSubtitles();
  }, [loadSubtitles]);

  const handleUploadSuccess = (subtitle: SubtitleTrack) => {
    setSubtitles((prev) => [...prev, subtitle]);
  };

  const handleSetDefault = async (language: string) => {
    setActionLoading(`default-${language}`);
    try {
      const result = await setDefaultSubtitle(videoId, language, {  channelId });
      if (result?.success) {
        // Update local state
        setSubtitles((prev) =>
          prev.map((sub) => ({
            ...sub,
            isDefault: sub.language === language,
          }))
        );
      }
    } catch (error) {
      console.error('Failed to set default subtitle:', error);
    } finally {
      setActionLoading(null);
    }
  };

  const handleDelete = async (subtitle: SubtitleTrack) => {
    setActionLoading(`delete-${subtitle.language}`);
    try {
      const result = await deleteSubtitle(videoId, subtitle.language, {  channelId });
      if (result?.success) {
        setSubtitles((prev) => prev.filter((sub) => sub.language !== subtitle.language));
      }
    } catch (error) {
      console.error('Failed to delete subtitle:', error);
    } finally {
      setActionLoading(null);
      setDeleteConfirm(null);
    }
  };

  const getLanguageInfo = (code: string) => {
    const langInfo = SUPPORTED_LANGUAGES.find((l) => l.code === code);
    return langInfo || { code, name: code, nameAr: code, flag: '🌐', rtl: false };
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  };

  const formatDate = (dateStr: string): string => {
    const date = new Date(dateStr);
    return new Intl.DateTimeFormat(lang === 'ar' ? 'ar-SA' : 'en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    }).format(date);
  };

  const getStatusBadge = (status: SubtitleTrack['status']) => {
    switch (status) {
      case 'active':
        return (
          <Badge variant="default" className="bg-green-500 text-white">
            {t.subtitle?.statusActive || 'Active'}
          </Badge>
        );
      case 'processing':
        return (
          <Badge variant="default" className="bg-blue-500 text-white">
            {t.subtitle?.statusProcessing || 'Processing'}
          </Badge>
        );
      case 'failed':
        return (
          <Badge variant="destructive">
            {t.subtitle?.statusFailed || 'Failed'}
          </Badge>
        );
    }
  };

  const existingLanguages = subtitles.map((sub) => sub.language);

  return (
    <div className={`space-y-4 md:space-y-6 ${className}`}>
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h3 className="
            text-lg
            md:text-xl
            font-semibold
            dark:text-white
            flex
            items-center
            gap-2
          ">
            <Languages className="w-5 h-5 md:w-6 md:h-6" />
            {t.subtitle?.subtitles || 'Subtitles / Captions'}
          </h3>
          <p className="
            text-xs
            md:text-sm
            text-gray-600
            dark:text-gray-400
            mt-1
          ">
            {t.subtitle?.subtitlesDescription ||
              'Upload subtitle files in multiple languages'}
          </p>
        </div>

        <Button
          onClick={() => setIsModalOpen(true)}
          disabled={isLoading || existingLanguages.length >= 10}
          className="
            w-full
            sm:w-auto
            h-10
            md:h-11
            bg-blue-500
            hover:bg-blue-600
            text-white
            flex
            items-center
            gap-2
          "
        >
          <Plus className="w-4 h-4 md:w-5 md:h-5" />
          {t.subtitle?.addSubtitle || 'Add Subtitle'}
        </Button>
      </div>

      {/* Loading State */}
      {isLoading && (
        <div className="flex items-center justify-center p-8 md:p-12">
          <Loader2 className="w-6 h-6 md:w-8 md:h-8 animate-spin text-blue-500" />
        </div>
      )}

      {/* Empty State */}
      {!isLoading && subtitles.length === 0 && (
        <Card className="
          p-6
          md:p-8
          text-center
          dark:bg-gray-800
          dark:border-gray-700
        ">
          <FileText className="
            w-12 h-12
            md:w-16 md:h-16
            mx-auto
            text-gray-400
            dark:text-gray-500
            mb-4
          " />
          <h4 className="
            text-base
            md:text-lg
            font-semibold
            text-gray-700
            dark:text-gray-300
            mb-2
          ">
            {t.subtitle?.noSubtitles || 'No subtitles uploaded yet'}
          </h4>
          <p className="
            text-sm
            md:text-base
            text-gray-600
            dark:text-gray-400
            mb-4
            max-w-md
            mx-auto
          ">
            {t.subtitle?.noSubtitlesDescription ||
              'Add subtitle tracks to make your video accessible in multiple languages'}
          </p>
          <Button
            onClick={() => setIsModalOpen(true)}
            className="bg-blue-500 hover:bg-blue-600 text-white"
          >
            <Plus className="w-4 h-4 mr-2" />
            {t.subtitle?.uploadFirstSubtitle || 'Upload First Subtitle'}
          </Button>
        </Card>
      )}

      {/* Subtitle List */}
      {!isLoading && subtitles.length > 0 && (
        <div className="
          grid
          grid-cols-1
          gap-3
          md:gap-4
        ">
          {subtitles.map((subtitle) => {
            const langInfo = getLanguageInfo(subtitle.language);
            const isProcessing = actionLoading?.includes(subtitle.language);

            return (
              <Card
                key={subtitle.language}
                className="
                  p-4
                  md:p-5
                  dark:bg-gray-800
                  dark:border-gray-700
                  transition-shadow
                  hover:shadow-md
                "
              >
                <div className="
                  flex
                  flex-col
                  sm:flex-row
                  sm:items-center
                  sm:justify-between
                  gap-3
                ">
                  {/* Left: Language Info */}
                  <div className="flex items-start gap-3 flex-1 min-w-0">
                    <span className="text-2xl md:text-3xl flex-shrink-0">
                      {langInfo.flag}
                    </span>

                    <div className="flex-1 min-w-0 space-y-1">
                      {/* Language Name */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <h4 className="
                          text-base
                          md:text-lg
                          font-semibold
                          text-gray-900
                          dark:text-gray-100
                        ">
                          {lang === 'ar' ? langInfo.nameAr : langInfo.name}
                        </h4>
                        {subtitle.isDefault && (
                          <Badge className="bg-blue-500 text-white flex items-center gap-1">
                            <Star className="w-3 h-3 fill-current" />
                            {t.subtitle?.default || 'Default'}
                          </Badge>
                        )}
                        {getStatusBadge(subtitle.status)}
                      </div>

                      {/* Metadata */}
                      <div className="
                        flex
                        flex-wrap
                        items-center
                        gap-x-3
                        gap-y-1
                        text-xs
                        md:text-sm
                        text-gray-600
                        dark:text-gray-400
                      ">
                        <span className="flex items-center gap-1">
                          <HardDrive className="w-3 h-3 md:w-4 md:h-4" />
                          {formatFileSize(subtitle.fileSize)}
                        </span>
                        <span className="flex items-center gap-1">
                          <Calendar className="w-3 h-3 md:w-4 md:h-4" />
                          {formatDate(subtitle.uploadDate)}
                        </span>
                      </div>
                    </div>
                  </div>

                  {/* Right: Actions */}
                  <div className="
                    flex
                    items-center
                    gap-2
                    sm:flex-shrink-0
                  ">
                    {!subtitle.isDefault && subtitle.status === 'active' && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => handleSetDefault(subtitle.language)}
                        disabled={isProcessing}
                        className="
                          h-8
                          md:h-9
                          text-xs
                          md:text-sm
                          dark:border-gray-600
                          dark:text-white
                          dark:hover:bg-gray-700
                          min-w-[100px]
                          md:min-w-[120px]
                        "
                      >
                        {actionLoading === `default-${subtitle.language}` ? (
                          <Loader2 className="w-3 h-3 md:w-4 md:h-4 animate-spin" />
                        ) : (
                          <>
                            <StarOff className="w-3 h-3 md:w-4 md:h-4 mr-1" />
                            {t.subtitle?.setDefault || 'Set Default'}
                          </>
                        )}
                      </Button>
                    )}

                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setDeleteConfirm(subtitle)}
                      disabled={isProcessing}
                      className="
                        h-8
                        md:h-9
                        text-xs
                        md:text-sm
                        border-red-200
                        text-red-600
                        hover:bg-red-50
                        hover:border-red-300
                        dark:border-red-800
                        dark:text-red-400
                        dark:hover:bg-red-900/20
                        min-w-[44px]
                        min-h-[44px]
                      "
                      aria-label={t.subtitle?.deleteSubtitle || 'Delete subtitle'}
                    >
                      {actionLoading === `delete-${subtitle.language}` ? (
                        <Loader2 className="w-3 h-3 md:w-4 md:h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-3 h-3 md:w-4 md:h-4" />
                      )}
                    </Button>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Upload Modal */}
      <SubtitleUploadModal
        videoId={videoId}
        channelId={channelId}
        open={isModalOpen}
        onOpenChange={setIsModalOpen}
        onUploadSuccess={handleUploadSuccess}
        existingLanguages={existingLanguages}
      />

      {/* Delete Confirmation Dialog */}
      <AlertDialog
        open={deleteConfirm !== null}
        onOpenChange={(open) => !open && setDeleteConfirm(null)}
      >
        <AlertDialogContent className="
          w-[calc(100%-2rem)]
          max-w-md
          dark:bg-gray-800
          dark:border-gray-700
        ">
          <AlertDialogHeader>
            <AlertDialogTitle className="dark:text-white">
              {t.subtitle?.confirmDelete || 'Delete Subtitle?'}
            </AlertDialogTitle>
            <AlertDialogDescription className="dark:text-gray-400">
              {t.subtitle?.confirmDeleteDescription ||
                'Are you sure you want to delete this subtitle track? This action cannot be undone.'}
              {deleteConfirm && (
                <span className="block mt-2 font-medium text-gray-900 dark:text-gray-100">
                  {lang === 'ar'
                    ? getLanguageInfo(deleteConfirm.language).nameAr
                    : getLanguageInfo(deleteConfirm.language).name}
                </span>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="
            flex-col-reverse
            sm:flex-row
            gap-2
            sm:gap-3
          ">
            <AlertDialogCancel className="
              w-full
              sm:w-auto
              dark:border-gray-600
              dark:text-white
              dark:hover:bg-gray-700
            ">
              {t.common?.cancel || 'Cancel'}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => deleteConfirm && handleDelete(deleteConfirm)}
              className="
                w-full
                sm:w-auto
                bg-red-600
                hover:bg-red-700
                text-white
              "
            >
              {t.subtitle?.delete || 'Delete'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
