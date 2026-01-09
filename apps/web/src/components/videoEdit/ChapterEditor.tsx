import { logger } from '@/lib/logger-client';

import React, { useState, useEffect } from 'react';
import { Plus, X, MoveUp, MoveDown, Save, AlertCircle } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { v4 as uuidv4 } from 'uuid';
import type { Chapter } from '@/lib/api/chapters';

interface ChapterEditorProps {
  videoId: string;
  videoDuration: number;
  initialChapters?: Chapter[];
  onSave?: (chapters: Chapter[]) => void;
  onCancel?: () => void;
  className?: string;
}

/**
 * Format seconds to timestamp string (HH:MM:SS or MM:SS)
 */
function formatTimestamp(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);

  if (hours > 0) {
    return `${hours}:${minutes.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${minutes}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Parse timestamp string to seconds
 * Supports: MM:SS or HH:MM:SS
 */
function parseTimestamp(timestamp: string): number | null {
  const parts = timestamp.split(':').map(Number);

  if (parts.some(isNaN)) {
    return null;
  }

  if (parts.length === 2) {
    // MM:SS
    const [minutes, seconds] = parts;
    return minutes * 60 + seconds;
  } else if (parts.length === 3) {
    // HH:MM:SS
    const [hours, minutes, seconds] = parts;
    return hours * 3600 + minutes * 60 + seconds;
  }

  return null;
}

export default function ChapterEditor({
  videoId: _videoId,
  videoDuration,
  initialChapters = [],
  onSave,
  onCancel,
  className = '',
}: ChapterEditorProps) {
  const { t, isRTL } = useLanguage();

  const [chapters, setChapters] = useState<Chapter[]>(
    initialChapters.length > 0
      ? initialChapters
      : [{
          id: uuidv4(),
          startTime: 0,
          endTime: videoDuration,
          title: '',
        }]
  );

  const [timestampInputs, setTimestampInputs] = useState<Record<string, string>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSaving, setIsSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Initialize timestamp inputs
  useEffect(() => {
    const inputs: Record<string, string> = {};
    chapters.forEach((chapter) => {
      inputs[chapter.id] = formatTimestamp(chapter.startTime);
    });
    setTimestampInputs(inputs);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Track changes
  useEffect(() => {
    const changed = JSON.stringify(chapters) !== JSON.stringify(initialChapters);
    setHasChanges(changed);
  }, [chapters, initialChapters]);

  const addChapter = () => {
    const lastChapter = chapters[chapters.length - 1];
    const newStartTime = lastChapter ? lastChapter.endTime : 0;

    if (newStartTime >= videoDuration) {
      setErrors({ global: t.video.maxChaptersReached ?? 'Maximum chapters reached' });
      return;
    }

    const newChapter: Chapter = {
      id: uuidv4(),
      startTime: newStartTime,
      endTime: videoDuration,
      title: '',
    };

    setChapters([...chapters, newChapter]);
    setTimestampInputs({
      ...timestampInputs,
      [newChapter.id]: formatTimestamp(newStartTime),
    });
    setErrors({});
    setHasChanges(true);
  };

  const removeChapter = (id: string) => {
    if (chapters.length === 1) {
      setErrors({ global: t.video.firstChapterMustBeZero ?? 'First chapter must start at 0:00' });
      return;
    }

    const filtered = chapters.filter((ch) => ch.id !== id);

    // Recalculate endTimes
    const updated = filtered.map((chapter, index) => ({
      ...chapter,
      endTime: index < filtered.length - 1 ? filtered[index + 1].startTime : videoDuration,
    }));

    setChapters(updated);

    const newInputs = { ...timestampInputs };
    delete newInputs[id];
    setTimestampInputs(newInputs);
    setErrors({});
    setHasChanges(true);
  };

  const updateChapterTitle = (id: string, title: string, lang?: 'en' | 'ar') => {
    setChapters(chapters.map((chapter) => {
      if (chapter.id === id) {
        if (lang) {
          return {
            ...chapter,
            titleLocalized: {
              ...chapter.titleLocalized,
              [lang]: title,
            },
          };
        }
        return { ...chapter, title };
      }
      return chapter;
    }));
    setHasChanges(true);
  };

  const updateChapterTimestamp = (id: string, value: string) => {
    setTimestampInputs({
      ...timestampInputs,
      [id]: value,
    });

    const seconds = parseTimestamp(value);
    if (seconds === null) {
      setErrors({ ...errors, [id]: t.video.invalidChapterFormat ?? 'Invalid timestamp format' });
      return;
    }

    if (seconds < 0 || seconds > videoDuration) {
      setErrors({ ...errors, [id]: t.video.invalidChapterFormat ?? 'Invalid timestamp format' });
      return;
    }

    const index = chapters.findIndex((ch) => ch.id === id);
    if (index === 0 && seconds !== 0) {
      setErrors({ ...errors, [id]: t.video.firstChapterMustBeZero ?? 'First chapter must start at 0:00' });
      return;
    }

    // Update chapters with new timestamp
    const updated = [...chapters];
    updated[index] = {
      ...updated[index],
      startTime: seconds,
    };

    // Recalculate endTimes
    updated.forEach((chapter, i) => {
      chapter.endTime = i < updated.length - 1 ? updated[i + 1].startTime : videoDuration;
    });

    // Sort by startTime
    updated.sort((a, b) => a.startTime - b.startTime);

    // Validate minimum duration
    const hasShortChapter = updated.some((ch) => {
      const duration = ch.endTime - ch.startTime;
      return duration < 10;
    });

    if (hasShortChapter) {
      setErrors({ ...errors, [id]: t.video.chapterTooClose ?? 'Chapters must be at least 10 seconds apart' });
      return;
    }

    setChapters(updated);

    const newErrors = { ...errors };
    delete newErrors[id];
    setErrors(newErrors);
    setHasChanges(true);
  };

  const moveChapter = (index: number, direction: 'up' | 'down') => {
    if (
      (direction === 'up' && index === 0) ||
      (direction === 'down' && index === chapters.length - 1)
    ) {
      return;
    }

    const newIndex = direction === 'up' ? index - 1 : index + 1;
    const reordered = [...chapters];
    [reordered[index], reordered[newIndex]] = [reordered[newIndex], reordered[index]];

    setChapters(reordered);
    setHasChanges(true);
  };

  const validateChapters = (): boolean => {
    const newErrors: Record<string, string> = {};

    // Check first chapter starts at 0
    if (chapters.length > 0 && chapters[0].startTime !== 0) {
      newErrors.global = t.video.firstChapterMustBeZero ?? 'First chapter must start at 0:00';
    }

    // Check all chapters have titles
    chapters.forEach((chapter) => {
      if (!chapter.title.trim()) {
        newErrors[chapter.id] = t.video.chapterTitleRequired ?? 'Chapter title is required';
      }
    });

    // Check minimum duration
    chapters.forEach((chapter) => {
      const duration = chapter.endTime - chapter.startTime;
      if (duration < 10) {
        newErrors[chapter.id] = t.video.chapterTooClose ?? 'Chapters must be at least 10 seconds apart';
      }
    });

    setErrors(newErrors);
    return Object.keys(newErrors).length === 0;
  };

  const handleSave = async () => {
    if (!validateChapters()) {
      return;
    }

    setIsSaving(true);

    try {
      await onSave?.(chapters);
      setHasChanges(false);
    } catch (error) {
      logger.error('Error saving chapters:', error);
      setErrors({ global: t.errors.genericError });
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={`${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold dark:text-white">
              {t.video.manualChapters}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              {t.video.chapterParserHelp}
            </p>
          </div>
          <button
            onClick={addChapter}
            className="flex items-center gap-2 px-4 py-2 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors text-sm"
          >
            <Plus size={16} />
            {t.video.addChapter}
          </button>
        </div>

        {/* Global Error */}
        {errors.global && (
          <div className="p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg flex items-start gap-2">
            <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
            <p className="text-sm text-red-700 dark:text-red-400">{errors.global}</p>
          </div>
        )}

        {/* Chapter List */}
        <div className="space-y-3">
          {chapters.map((chapter, index) => (
            <div
              key={chapter.id}
              className="p-4 border dark:border-gray-600 rounded-lg bg-white dark:bg-gray-800 space-y-3"
            >
              <div className="flex items-start gap-3">
                {/* Timestamp Input */}
                <div className="flex-shrink-0 w-28">
                  <label className="block text-xs font-medium mb-1 dark:text-gray-300">
                    {t.video.chapterTimestamp}
                  </label>
                  <input
                    type="text"
                    value={timestampInputs[chapter.id] || ''}
                    onChange={(e) => updateChapterTimestamp(chapter.id, e.target.value)}
                    placeholder="0:00"
                    disabled={index === 0} // First chapter must stay at 0:00
                    className={`w-full px-3 py-2 text-sm border rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white ${
                      index === 0 ? 'bg-gray-100 dark:bg-gray-600 cursor-not-allowed' : ''
                    } ${
                      errors[chapter.id]
                        ? 'border-red-500 dark:border-red-400'
                        : 'border-gray-300 dark:border-gray-600'
                    }`}
                  />
                  {errors[chapter.id] && (
                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                      {errors[chapter.id]}
                    </p>
                  )}
                </div>

                {/* Title Input */}
                <div className="flex-1">
                  <label className="block text-xs font-medium mb-1 dark:text-gray-300">
                    {t.video.chapterTitle}
                  </label>
                  <input
                    type="text"
                    value={chapter.title}
                    onChange={(e) => updateChapterTitle(chapter.id, e.target.value)}
                    placeholder={t.video.chapterTitle}
                    maxLength={200}
                    className="w-full px-3 py-2 text-sm border dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-transparent dark:bg-gray-700 dark:text-white"
                  />
                  <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                    {chapter.title.length}/200 {t.channel.charactersRemaining}
                  </p>
                </div>

                {/* Actions */}
                <div className="flex flex-col gap-1 flex-shrink-0">
                  <button
                    onClick={() => moveChapter(index, 'up')}
                    disabled={index === 0}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={t.video.moveChapterUp}
                  >
                    <MoveUp size={16} className="dark:text-white" />
                  </button>
                  <button
                    onClick={() => moveChapter(index, 'down')}
                    disabled={index === chapters.length - 1}
                    className="p-2 hover:bg-gray-100 dark:hover:bg-gray-700 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={t.video.moveChapterDown}
                  >
                    <MoveDown size={16} className="dark:text-white" />
                  </button>
                  <button
                    onClick={() => removeChapter(chapter.id)}
                    disabled={chapters.length === 1}
                    className="p-2 hover:bg-red-100 dark:hover:bg-red-900/20 rounded disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    aria-label={t.video.deleteChapter}
                  >
                    <X size={16} className="text-red-600 dark:text-red-400" />
                  </button>
                </div>
              </div>

              {/* Duration Preview */}
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {t.video.videoDuration}: {formatTimestamp(chapter.endTime - chapter.startTime)}
                {' • '}
                {formatTimestamp(chapter.startTime)} - {formatTimestamp(chapter.endTime)}
              </div>
            </div>
          ))}
        </div>

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t dark:border-gray-700">
          <button
            onClick={handleSave}
            disabled={isSaving || !hasChanges}
            className="flex items-center gap-2 flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            <Save size={18} />
            {isSaving ? t.video.saving : t.video.saveChanges}
          </button>
          {onCancel && (
            <button
              onClick={onCancel}
              disabled={isSaving}
              className="px-6 py-3 border dark:border-gray-600 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors dark:text-white font-medium"
            >
              {t.common.cancel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
