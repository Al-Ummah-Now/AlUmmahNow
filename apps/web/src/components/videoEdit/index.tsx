"use client";

import React, { useState, useEffect } from 'react';
import { X, Plus, FileText, Edit3 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { VideoObject } from '@/interfaces';
import { updateVideo } from '@/lib/api/videos';
import { updateChapters, type Chapter } from '@/lib/api/chapters';
import VideoPreview from '@/components/videoPreview/index';
import VideoPreviewRTL from '@/components/videoPreview/rtl/index';
import ThumbnailSelector from './ThumbnailSelector';
import SubtitleUploadSection from './SubtitleUploadSection';
import ChapterEditor from './ChapterEditor';
import ChapterUpload from './ChapterUpload';

interface VideoEditProps {
  video: VideoObject;
  userId: string;
  channelId: string;
  onSave?: (updatedVideo: VideoObject) => void;
  onCancel?: () => void;
  className?: string;
}

type EditFormData = {
  titleEn: string;
  titleAr: string;
  descriptionEn: string;
  descriptionAr: string;
  tags: string[];
  category: string;
  language: 'en' | 'ar' | 'both';
  isPublic: boolean;
  thumbnailUrl: string;
};

export default function VideoEdit({
  video,
  userId,
  channelId,
  onSave,
  onCancel,
  className = '',
}: VideoEditProps) {
  const { t, isRTL } = useLanguage();
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [isSaving, setIsSaving] = useState(false);
  const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [tagInput, setTagInput] = useState('');
  const [chapterMode, setChapterMode] = useState<'none' | 'manual' | 'upload'>('none');
  const [chapters, setChapters] = useState<Chapter[]>([]);

  const [formData, setFormData] = useState<EditFormData>({
    titleEn: video.titleLocalized?.en || video.title || '',
    titleAr: video.titleLocalized?.ar || '',
    descriptionEn: video.descriptionLocalized?.en || video.description || '',
    descriptionAr: video.descriptionLocalized?.ar || '',
    tags: [], // TODO: Parse from video.tags if available
    category: '', // TODO: Parse from video.category if available
    language: 'both',
    isPublic: video.isPublic !== false,
    thumbnailUrl: video.thumbnailUrl,
  });

  // Track changes
  useEffect(() => {
    const hasChanges =
      formData.titleEn !== (video.titleLocalized?.en || video.title || '') ||
      formData.titleAr !== (video.titleLocalized?.ar || '') ||
      formData.descriptionEn !== (video.descriptionLocalized?.en || video.description || '') ||
      formData.descriptionAr !== (video.descriptionLocalized?.ar || '') ||
      formData.thumbnailUrl !== video.thumbnailUrl ||
      formData.isPublic !== (video.isPublic !== false);

    setHasUnsavedChanges(hasChanges);
  }, [formData, video]);

  const handleInputChange = (field: keyof EditFormData, value: string | boolean) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
    setError(null);
    setSuccess(null);
  };

  const handleAddTag = () => {
    if (tagInput.trim() && !formData.tags.includes(tagInput.trim())) {
      setFormData((prev) => ({
        ...prev,
        tags: [...prev.tags, tagInput.trim()],
      }));
      setTagInput('');
    }
  };

  const handleRemoveTag = (tag: string) => {
    setFormData((prev) => ({
      ...prev,
      tags: prev.tags.filter((t) => t !== tag),
    }));
  };

  const handleSave = async () => {
    setError(null);
    setSuccess(null);

    // Validation
    if (!formData.titleEn.trim() && !formData.titleAr.trim()) {
      setError(t.validation.required);
      return;
    }

    setIsSaving(true);

    try {
      const updateData = {
        titleLocalized: {
          en: formData.titleEn,
          ar: formData.titleAr,
        },
        descriptionLocalized: {
          en: formData.descriptionEn,
          ar: formData.descriptionAr,
        },
        thumbnailUrl: formData.thumbnailUrl,
        isPublic: formData.isPublic,
      };

      const result = await updateVideo(video.id, updateData, { userId, channelId });

      if (result?.data?.video) {
        setSuccess(t.video.updateSuccess ?? 'Video updated successfully');
        setHasUnsavedChanges(false);
        onSave?.(result.data.video);
      } else {
        setError(t.video.updateFailed ?? 'Failed to update video');
      }
    } catch (err) {
      console.error('Error saving video:', err);
      setError(t.errors.genericError);
    } finally {
      setIsSaving(false);
    }
  };

  const handleCancel = () => {
    if (hasUnsavedChanges) {
      if (confirm(t.video.unsavedChangesMessage)) {
        onCancel?.();
      }
    } else {
      onCancel?.();
    }
  };

  const VideoPreviewComponent = isRTL ? VideoPreviewRTL : VideoPreview;

  return (
    <div className={`bg-white dark:bg-gray-900 rounded-lg shadow-lg ${className}`}>
      {/* Header */}
      <div className="border-b dark:border-gray-700 p-6">
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold dark:text-white">{t.video.editVideoDetails}</h2>
          {hasUnsavedChanges && (
            <span className="text-sm text-orange-600 dark:text-orange-400 font-medium">
              {t.video.unsavedChanges}
            </span>
          )}
        </div>
      </div>

      <div className="p-6 space-y-6">
        {/* Video Preview */}
        <div>
          <h3 className="text-lg font-semibold mb-3 dark:text-white">{t.video.videoPreview}</h3>
          <VideoPreviewComponent
            videoUrl={video.videoUrl}
            posterUrl={video.thumbnailUrl}
            className="max-w-2xl aspect-video"
          />
        </div>

        {/* Language Tabs for Title and Description */}
        <div>
          <div className="flex gap-2 border-b dark:border-gray-700 mb-4">
            <button
              onClick={() => setActiveTab('en')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'en'
                  ? 'border-b-2 border-blue-500 text-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              English
            </button>
            <button
              onClick={() => setActiveTab('ar')}
              className={`px-4 py-2 font-medium transition-colors ${
                activeTab === 'ar'
                  ? 'border-b-2 border-blue-500 text-blue-500'
                  : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
              }`}
            >
              العربية
            </button>
          </div>

          {/* English Tab */}
          {activeTab === 'en' && (
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-2 dark:text-white">
                  {t.video.titleEnglish}
                </label>
                <input
                  type="text"
                  value={formData.titleEn}
                  onChange={(e) => handleInputChange('titleEn', e.target.value)}
                  className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                  placeholder="Enter video title in English"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 dark:text-white">
                  {t.video.descriptionEnglish}
                </label>
                <textarea
                  value={formData.descriptionEn}
                  onChange={(e) => handleInputChange('descriptionEn', e.target.value)}
                  rows={6}
                  className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white resize-none"
                  placeholder="Enter video description in English"
                />
              </div>
            </div>
          )}

          {/* Arabic Tab */}
          {activeTab === 'ar' && (
            <div className="space-y-4" dir="rtl">
              <div>
                <label className="block text-sm font-medium mb-2 dark:text-white">
                  {t.video.titleArabic}
                </label>
                <input
                  type="text"
                  value={formData.titleAr}
                  onChange={(e) => handleInputChange('titleAr', e.target.value)}
                  className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
                  placeholder="أدخل عنوان الفيديو بالعربية"
                />
              </div>

              <div>
                <label className="block text-sm font-medium mb-2 dark:text-white">
                  {t.video.descriptionArabic}
                </label>
                <textarea
                  value={formData.descriptionAr}
                  onChange={(e) => handleInputChange('descriptionAr', e.target.value)}
                  rows={6}
                  className="w-full px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white resize-none"
                  placeholder="أدخل وصف الفيديو بالعربية"
                />
              </div>
            </div>
          )}
        </div>

        {/* Thumbnail Selector */}
        <ThumbnailSelector
          videoId={video.id}
          currentThumbnailUrl={video.thumbnailUrl}
          userId={userId}
          channelId={channelId}
          onThumbnailChange={(url) => handleInputChange('thumbnailUrl', url)}
        />

        {/* Tags */}
        <div>
          <label className="block text-sm font-medium mb-2 dark:text-white">
            {t.video.videoTags}
          </label>
          <div className="flex gap-2 mb-3">
            <input
              type="text"
              value={tagInput}
              onChange={(e) => setTagInput(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && (e.preventDefault(), handleAddTag())}
              className="flex-1 px-4 py-2 border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-800 dark:text-white"
              placeholder={t.video.enterTag}
            />
            <button
              onClick={handleAddTag}
              className="px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors flex items-center gap-2"
            >
              <Plus size={16} />
              {t.video.addTag}
            </button>
          </div>
          {formData.tags.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {formData.tags.map((tag) => (
                <span
                  key={tag}
                  className="inline-flex items-center gap-2 px-3 py-1 bg-gray-100 dark:bg-gray-800 text-gray-800 dark:text-gray-200 rounded-full text-sm"
                >
                  {tag}
                  <button
                    onClick={() => handleRemoveTag(tag)}
                    className="hover:text-red-500 transition-colors"
                    aria-label={t.video.removeTag}
                  >
                    <X size={14} />
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>

        {/* Privacy */}
        <div>
          <label className="block text-sm font-medium mb-2 dark:text-white">
            {t.video.videoPrivacy}
          </label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-4 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
              <input
                type="radio"
                name="privacy"
                checked={formData.isPublic}
                onChange={() => handleInputChange('isPublic', true)}
                className="w-4 h-4"
              />
              <div>
                <div className="font-medium dark:text-white">{t.video.public}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{t.video.publicVideo}</div>
              </div>
            </label>
            <label className="flex items-center gap-3 p-4 border dark:border-gray-600 rounded-lg cursor-pointer hover:bg-gray-50 dark:hover:bg-gray-800">
              <input
                type="radio"
                name="privacy"
                checked={!formData.isPublic}
                onChange={() => handleInputChange('isPublic', false)}
                className="w-4 h-4"
              />
              <div>
                <div className="font-medium dark:text-white">{t.video.private}</div>
                <div className="text-sm text-gray-600 dark:text-gray-400">{t.video.privateVideo}</div>
              </div>
            </label>
          </div>
        </div>

        {/* Subtitles/Captions Section */}
        <SubtitleUploadSection
          videoId={video.id}
          userId={userId}
          channelId={channelId}
        />

        {/* Video Chapters Section */}
        <div>
          <label className="block text-sm font-medium mb-2 dark:text-white">
            {t.video.chapters}
          </label>
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
            {t.video.chapterParserHelp}
          </p>

          {/* Chapter Mode Selector */}
          {chapterMode === 'none' && (
            <div className="flex gap-3">
              <button
                onClick={() => setChapterMode('manual')}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-4 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <Edit3 size={20} className="text-blue-500" />
                <div className="text-left">
                  <div className="font-medium dark:text-white">{t.video.manualChapters}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Create chapters manually
                  </div>
                </div>
              </button>
              <button
                onClick={() => setChapterMode('upload')}
                className="flex-1 flex items-center justify-center gap-2 px-6 py-4 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
              >
                <FileText size={20} className="text-green-500" />
                <div className="text-left">
                  <div className="font-medium dark:text-white">{t.video.importedChapters}</div>
                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    Upload chapter file
                  </div>
                </div>
              </button>
            </div>
          )}

          {/* Manual Chapter Editor */}
          {chapterMode === 'manual' && (
            <div className="border dark:border-gray-600 rounded-lg p-4">
              <ChapterEditor
                videoId={video.id}
                videoDuration={video.duration || 0}
                initialChapters={chapters}
                onSave={async (newChapters) => {
                  try {
                    const result = await updateChapters(video.id, newChapters, 'manual');
                    if (result?.success) {
                      setChapters(newChapters);
                      setSuccess(t.video.chaptersParsed ?? 'Chapters saved successfully');
                      setChapterMode('none');
                    } else {
                      setError(result?.error || t.errors.genericError);
                    }
                  } catch (err) {
                    console.error('Error saving chapters:', err);
                    setError(t.errors.genericError);
                  }
                }}
                onCancel={() => setChapterMode('none')}
              />
            </div>
          )}

          {/* Chapter Upload */}
          {chapterMode === 'upload' && (
            <div className="border dark:border-gray-600 rounded-lg p-4">
              <ChapterUpload
                videoId={video.id}
                videoDuration={video.duration || 0}
                onChaptersParsed={async (parsedChapters) => {
                  try {
                    const result = await updateChapters(video.id, parsedChapters, 'imported');
                    if (result?.success) {
                      setChapters(parsedChapters);
                      setSuccess(`${parsedChapters.length} ${t.video.chaptersDetected}`);
                      setChapterMode('none');
                    } else {
                      setError(result?.error || t.errors.genericError);
                    }
                  } catch (err) {
                    console.error('Error saving chapters:', err);
                    setError(t.errors.genericError);
                  }
                }}
                onCancel={() => setChapterMode('none')}
              />
            </div>
          )}

          {/* Show current chapters if they exist */}
          {chapters.length > 0 && chapterMode === 'none' && (
            <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-green-700 dark:text-green-400">
                    {chapters.length} {t.video.chaptersDetected}
                  </p>
                  <p className="text-xs text-green-600 dark:text-green-500 mt-1">
                    Click button to edit chapters
                  </p>
                </div>
                <button
                  onClick={() => setChapterMode('manual')}
                  className="px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors text-sm"
                >
                  {t.video.editChapter}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Error/Success Messages */}
        {error && (
          <div className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg text-red-700 dark:text-red-400">
            {error}
          </div>
        )}
        {success && (
          <div className="p-4 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg text-green-700 dark:text-green-400">
            {success}
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t dark:border-gray-700">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasUnsavedChanges}
            className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {isSaving ? t.video.saving : t.video.saveChanges}
          </button>
          <button
            onClick={handleCancel}
            disabled={isSaving}
            className="px-6 py-3 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-white font-medium"
          >
            {t.common.cancel}
          </button>
        </div>
      </div>
    </div>
  );
}
