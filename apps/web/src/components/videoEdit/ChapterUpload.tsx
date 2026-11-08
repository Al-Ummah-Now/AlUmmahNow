import { logger } from '@/lib/logger-client';

import React, { useState, useRef } from 'react';
import { Upload, FileText, AlertCircle, Check, X } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import { v4 as uuidv4 } from 'uuid';
import type { Chapter } from '@/lib/api/chapters';

interface ChapterUploadProps {
  videoId: string;
  videoDuration: number;
  onChaptersParsed?: (chapters: Chapter[]) => void;
  onCancel?: () => void;
  className?: string;
}

interface ParseError {
  line: number;
  message: string;
}

/**
 * Parse timestamp from text (supports MM:SS or HH:MM:SS)
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

/**
 * Parse chapter file content
 * Format: "MM:SS Chapter Title" or "HH:MM:SS Chapter Title"
 */
function parseChapterFile(
  content: string,
  videoDuration: number
): { chapters: Chapter[]; errors: ParseError[] } {
  const lines = content.split('\n');
  const chapters: Chapter[] = [];
  const errors: ParseError[] = [];

  lines.forEach((line, index) => {
    const trimmed = line.trim();
    if (!trimmed) return;

    // Match "MM:SS Title" or "HH:MM:SS Title"
    const match = trimmed.match(/^(\d{1,2}:\d{2}(?::\d{2})?)\s+(.+)$/);

    if (!match) {
      errors.push({
        line: index + 1,
        message: `Invalid format. Expected "MM:SS Title" or "HH:MM:SS Title"`,
      });
      return;
    }

    const [, timestamp, title] = match;
    const startTime = parseTimestamp(timestamp);

    if (startTime === null) {
      errors.push({
        line: index + 1,
        message: `Invalid timestamp: ${timestamp}`,
      });
      return;
    }

    if (startTime > videoDuration) {
      errors.push({
        line: index + 1,
        message: `Timestamp ${timestamp} exceeds video duration`,
      });
      return;
    }

    chapters.push({
      id: uuidv4(),
      startTime,
      endTime: 0, // Will be calculated
      title: title.trim(),
    });
  });

  // Sort chapters by startTime
  chapters.sort((a, b) => a.startTime - b.startTime);

  // Validate first chapter starts at 0
  if (chapters.length > 0 && chapters[0].startTime !== 0) {
    errors.push({
      line: 0,
      message: 'First chapter must start at 0:00',
    });
  }

  // Calculate endTimes
  chapters.forEach((chapter, index) => {
    chapter.endTime =
      index < chapters.length - 1 ? chapters[index + 1].startTime : videoDuration;
  });

  // Validate minimum duration (10 seconds)
  chapters.forEach((chapter, index) => {
    const duration = chapter.endTime - chapter.startTime;
    if (duration < 10) {
      errors.push({
        line: index + 1,
        message: `Chapter "${chapter.title}" is too short (${duration}s < 10s)`,
      });
    }
  });

  return { chapters, errors };
}

export default function ChapterUpload({
  videoId: _videoId,
  videoDuration,
  onChaptersParsed,
  onCancel,
  className = '',
}: ChapterUploadProps) {
  const { t, isRTL } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [parsedChapters, setParsedChapters] = useState<Chapter[]>([]);
  const [parseErrors, setParseErrors] = useState<ParseError[]>([]);
  const [isParsing, setIsParsing] = useState(false);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    // Validate file size (max 100KB)
    if (file.size > 100 * 1024) {
      setParseErrors([{ line: 0, message: t.video.chapterFileTooLarge ?? 'File too large (max 100KB)' }]);
      return;
    }

    // Validate file type
    if (!file.name.match(/\.(txt|srt)$/i)) {
      setParseErrors([{ line: 0, message: t.video.chapterFileType ?? 'Only .txt or .srt files are supported' }]);
      return;
    }

    setSelectedFile(file);
    parseFile(file);
  };

  const parseFile = async (file: File) => {
    setIsParsing(true);
    setParsedChapters([]);
    setParseErrors([]);

    try {
      const content = await file.text();
      const { chapters, errors } = parseChapterFile(content, videoDuration);

      setParsedChapters(chapters);
      setParseErrors(errors);
    } catch (error) {
      logger.error('Error parsing file:', error);
      setParseErrors([{ line: 0, message: t.video.chapterFileReadFailed ?? 'Failed to read file' }]);
    } finally {
      setIsParsing(false);
    }
  };

  const handleImport = () => {
    if (parsedChapters.length > 0 && parseErrors.length === 0) {
      onChaptersParsed?.(parsedChapters);
    }
  };

  const handleReset = () => {
    setSelectedFile(null);
    setParsedChapters([]);
    setParseErrors([]);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  return (
    <div className={`${className}`} dir={isRTL ? 'rtl' : 'ltr'}>
      <div className="space-y-4">
        {/* Header */}
        <div>
          <h3 className="text-lg font-semibold dark:text-white">
            {t.video.importedChapters}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {t.video.chapterParserHelp}
          </p>
          <p className="text-xs text-gray-500 dark:text-gray-500 mt-1">
            {t.video.chapterParserExample}
          </p>
        </div>

        {/* File Upload Area */}
        {!selectedFile && (
          <div
            onClick={() => fileInputRef.current?.click()}
            data-testid="chapter-file-dropzone"
            className="border-2 border-dashed dark:border-gray-600 rounded-lg p-8 text-center cursor-pointer hover:border-blue-500 dark:hover:border-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900/10 transition-colors"
          >
            <div className="flex flex-col items-center gap-3">
              <Upload size={48} className="text-gray-400 dark:text-gray-500" />
              <div>
                <p className="font-medium dark:text-white">{t.upload.selectFile}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                  {t.video.chapterFileHint}
                </p>
                <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
                  {t.video.chapterFileSupported}
                </p>
              </div>
            </div>
            <input
              ref={fileInputRef}
              type="file"
              accept=".txt,.srt"
              aria-label={t.video.chapterFileInput}
              data-testid="chapter-file-input"
              onChange={handleFileSelect}
              className="hidden"
            />
          </div>
        )}

        {/* Selected File Info */}
        {selectedFile && (
          <div className="flex items-center justify-between p-4 bg-gray-50 dark:bg-gray-800 rounded-lg">
            <div className="flex items-center gap-3">
              <FileText size={24} className="text-blue-500" />
              <div>
                <p className="font-medium dark:text-white">{selectedFile.name}</p>
                <p className="text-sm text-gray-500 dark:text-gray-400">
                  {(selectedFile.size / 1024).toFixed(2)} KB
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={handleReset}
              data-testid="chapter-file-remove"
              className="p-2 hover:bg-gray-200 dark:hover:bg-gray-700 rounded-lg transition-colors"
              aria-label={t.video.removeChapterFile}
            >
              <X size={20} className="text-gray-600 dark:text-gray-400" />
            </button>
          </div>
        )}

        {/* Parsing Status */}
        {isParsing && (
          <div className="p-4 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
            <p className="text-sm text-blue-700 dark:text-blue-400">
              {t.video.parsingChapters}
            </p>
          </div>
        )}

        {/* Parse Errors */}
        {parseErrors.length > 0 && (
          <div role="alert" data-testid="chapter-file-errors" className="p-4 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg space-y-2">
            <div className="flex items-start gap-2">
              <AlertCircle size={20} className="text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="font-medium text-red-700 dark:text-red-400">
                  {(t.video.chapterErrorsFound ?? '{count} error(s) found').replace('{count}', String(parseErrors.length))}
                </p>
                <ul className="mt-2 space-y-1">
                  {parseErrors.map((error, index) => (
                    <li key={index} className="text-sm text-red-600 dark:text-red-400">
                      {error.line > 0 && (t.video.chapterErrorLine ?? 'Line {line}: ').replace('{line}', String(error.line))}
                      {error.message}
                    </li>
                  ))}
                </ul>
              </div>
            </div>
          </div>
        )}

        {/* Parsed Chapters Preview */}
        {parsedChapters.length > 0 && parseErrors.length === 0 && (
          <div className="space-y-3" data-testid="chapter-file-preview">
            <div className="flex items-center gap-2 p-3 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg">
              <Check size={20} className="text-green-600 dark:text-green-400" />
              <p className="text-sm text-green-700 dark:text-green-400">
                {parsedChapters.length} {t.video.chaptersDetected}
              </p>
            </div>

            <div className="border dark:border-gray-600 rounded-lg overflow-hidden">
              <div className="bg-gray-50 dark:bg-gray-800 px-4 py-2 border-b dark:border-gray-600">
                <p className="text-sm font-medium dark:text-white">
                  {t.video.previewChapters}
                </p>
              </div>
              <div className="divide-y dark:divide-gray-600 max-h-64 overflow-y-auto">
                {parsedChapters.map((chapter) => (
                  <div
                    key={chapter.id}
                    data-testid="chapter-file-preview-item"
                    className="px-4 py-3 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span className="text-sm font-mono text-gray-600 dark:text-gray-400 flex-shrink-0 w-16">
                        {Math.floor(chapter.startTime / 60)}:{(chapter.startTime % 60).toString().padStart(2, '0')}
                      </span>
                      <p className="text-sm dark:text-white flex-1">{chapter.title}</p>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* Action Buttons */}
        <div className="flex gap-3 pt-4 border-t dark:border-gray-700">
          <button
            type="button"
            data-testid="chapter-file-import"
            onClick={handleImport}
            disabled={parsedChapters.length === 0 || parseErrors.length > 0}
            className="flex-1 px-6 py-3 bg-blue-500 text-white rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed font-medium"
          >
            {t.video.parseChapters}
          </button>
          {onCancel && (
            <button
              type="button"
              data-testid="chapter-file-cancel"
              onClick={onCancel}
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
