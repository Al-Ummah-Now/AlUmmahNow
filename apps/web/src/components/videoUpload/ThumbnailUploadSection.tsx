'use client';
import { logger } from '@/lib/logger-client';

import React, { useState, useEffect, useCallback } from 'react';
import { Upload, CheckCircle, AlertCircle } from 'lucide-react';
import { extractVideoFrames } from '@/lib/utils/videoFrameExtractor';
import { validateThumbnailFile, fileToBase64 } from '@/lib/utils/thumbnailValidator';
import { useLanguage } from '@/hooks/useLanguage';

export interface ThumbnailData {
  type: 'auto' | 'custom';
  data?: string; // Base64 for custom
  preview: string; // Preview URL
  position?: number; // For auto-generated (0-100%)
  filename?: string;
}

interface ThumbnailUploadSectionProps {
  videoFile: File | null;
  onThumbnailSelect: (thumbnail: ThumbnailData | null) => void;
  className?: string;
  disabled?: boolean;
}

export function ThumbnailUploadSection({
  videoFile,
  onThumbnailSelect,
  className = '',
  disabled = false
}: ThumbnailUploadSectionProps) {
  const { t } = useLanguage();
  const [autoThumbnails, setAutoThumbnails] = useState<string[]>([]);
  const [/* customThumbnail */ _customThumbnail, setCustomThumbnail] = useState<File | null>(null);
  const [selectedThumbnail, setSelectedThumbnail] = useState<ThumbnailData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // Extract frames from video for auto-thumbnails
  useEffect(() => {
    if (videoFile && !disabled) {
      setLoading(true);
      setError(null);

      extractVideoFrames(videoFile, [10, 25, 50, 75, 90])
        .then(frames => {
          setAutoThumbnails(frames);
          setLoading(false);
        })
        .catch(err => {
          logger.error('Failed to extract frames:', err);
          setError(t.upload.frameExtractFailed);
          setLoading(false);
        });
    } else {
      setAutoThumbnails([]);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps -- re-extract only when the file changes
  }, [videoFile, disabled]);

  // Handle auto-thumbnail selection
  const handleAutoSelect = useCallback((frame: string, index: number) => {
    if (disabled) return;

    const positions = [10, 25, 50, 75, 90];
    const thumbnailData: ThumbnailData = {
      type: 'auto',
      preview: frame,
      position: positions[index],
      data: frame,
    };

    setSelectedThumbnail(thumbnailData);
    setCustomThumbnail(null);
    onThumbnailSelect(thumbnailData);
  }, [disabled, onThumbnailSelect]);

  // Handle custom thumbnail upload
  const handleCustomUpload = useCallback(async (file: File) => {
    if (disabled) return;

    setError(null);

    // Validate file
    const validation = await validateThumbnailFile(file);
    if (!validation.valid) {
      // The validator reports English text; show the localized equivalent
      const reason = validation.error || '';
      setError(
        /size/i.test(reason)
          ? t.video.thumbnailTooLarge
          : /dimension|small/i.test(reason)
          ? t.upload.thumbnailTooSmall
          : t.video.thumbnailInvalidType
      );
      return;
    }

    // Show warnings if any
    if (validation.warnings && validation.warnings.length > 0) {
      logger.warn('Thumbnail warnings:', validation.warnings);
    }

    // Convert to base64
    try {
      const base64 = await fileToBase64(file);

      const thumbnailData: ThumbnailData = {
        type: 'custom',
        data: base64,
        preview: base64,
        filename: file.name,
      };

      setCustomThumbnail(file);
      setSelectedThumbnail(thumbnailData);
      onThumbnailSelect(thumbnailData);
    } catch (_err) {
      setError(t.upload.thumbnailProcessFailed);
    }
  }, [disabled, onThumbnailSelect, t]);

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleCustomUpload(files[0]);
    }
  };

  // Handle drag and drop
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) {
      setIsDragOver(true);
    }
  }, [disabled]);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    if (disabled) return;

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0 && files[0].type.startsWith('image/')) {
      handleCustomUpload(files[0]);
    } else {
      setError(t.upload.dropImageError);
    }
  }, [disabled, handleCustomUpload, t]);

  // Clear selection
  const handleClearSelection = () => {
    setSelectedThumbnail(null);
    setCustomThumbnail(null);
    onThumbnailSelect(null);
  };

  return (
    <div className={`${className}`} data-testid="upload-thumbnail-section">
      <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
        {t.upload.chooseThumbnail}
      </h3>

      {/* Error message */}
      {error && (
        <div role="alert" data-testid="upload-thumbnail-error" className="mb-4 p-3 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-md flex items-center text-red-800 dark:text-red-200">
          <AlertCircle size={16} className="me-2" />
          <span className="text-sm">{error}</span>
        </div>
      )}

      {/* Auto-generated thumbnails */}
      {videoFile && (
        <div className="mb-6">
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t.upload.autoGeneratedOptions}
          </h4>

          {loading ? (
            <div className="flex items-center justify-center py-8" role="status" data-testid="upload-thumbnail-extracting">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
              <span className="ms-3 text-sm text-gray-600 dark:text-gray-400">
                {t.upload.extractingFrames}
              </span>
            </div>
          ) : autoThumbnails.length > 0 ? (
            <div className="grid grid-cols-3 sm:grid-cols-5 gap-2" data-testid="upload-thumbnail-frames">
              {autoThumbnails.map((thumb, idx) => (
                <ThumbnailOption
                  key={idx}
                  src={thumb}
                  selected={selectedThumbnail?.type === 'auto' && selectedThumbnail?.preview === thumb}
                  onClick={() => handleAutoSelect(thumb, idx)}
                  disabled={disabled}
                  label={`${[10, 25, 50, 75, 90][idx]}%`}
                  ariaLabel={t.upload.thumbnailAtPosition.replace('{position}', `${[10, 25, 50, 75, 90][idx]}%`)}
                />
              ))}
            </div>
          ) : (
            <div className="text-sm text-gray-500 dark:text-gray-400 text-center py-4">
              {t.upload.noFramePreview}
            </div>
          )}
        </div>
      )}

      {/* Custom upload area */}
      <div className="mb-6">
        <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
          {t.upload.orUploadCustomThumbnail}
        </h4>

        <div
          className={`relative border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
            isDragOver
              ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
              : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
          } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            onChange={handleFileInputChange}
            disabled={disabled}
            aria-label={t.upload.customThumbnailInput}
            data-testid="upload-thumbnail-input"
            className="absolute inset-0 w-full h-full opacity-0 cursor-pointer disabled:cursor-not-allowed"
          />

          <div className="flex flex-col items-center">
            <Upload
              size={32}
              className={`mb-2 ${
                isDragOver ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
              }`}
            />
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-1">
              {isDragOver ? t.upload.thumbnailDropHere : t.upload.thumbnailClickOrDrag}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {t.upload.thumbnailFormats}
            </p>
          </div>
        </div>
      </div>

      {/* Preview */}
      {selectedThumbnail && (
        <div className="mb-4" data-testid="upload-thumbnail-preview" data-type={selectedThumbnail.type}>
          <h4 className="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">
            {t.upload.selectedThumbnail}
          </h4>
          <div className="relative rounded-lg overflow-hidden border-2 border-blue-500 dark:border-blue-400">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selectedThumbnail.preview}
              alt={t.upload.selectedThumbnail}
              className="w-full h-auto"
            />
            <div className="absolute top-2 end-2 bg-blue-600 text-white px-2 py-1 rounded-md flex items-center text-xs">
              <CheckCircle size={12} className="me-1" />
              {t.upload.thumbnailSelectedBadge}
            </div>
            {selectedThumbnail.type === 'custom' && selectedThumbnail.filename && (
              <div className="absolute bottom-0 inset-x-0 bg-black bg-opacity-60 text-white px-3 py-2 text-xs">
                {selectedThumbnail.filename}
              </div>
            )}
          </div>
          {!disabled && (
            <button
              type="button"
              data-testid="upload-thumbnail-clear"
              onClick={handleClearSelection}
              className="mt-2 text-sm text-blue-600 dark:text-blue-400 hover:underline"
            >
              {t.upload.clearThumbnailSelection}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

// Thumbnail option component
interface ThumbnailOptionProps {
  src: string;
  selected: boolean;
  onClick: () => void;
  disabled?: boolean;
  label?: string;
  ariaLabel?: string;
}

function ThumbnailOption({ src, selected, onClick, disabled, label, ariaLabel }: ThumbnailOptionProps) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      aria-label={ariaLabel}
      data-testid="upload-thumbnail-frame"
      onClick={onClick}
      disabled={disabled}
      className={`relative aspect-video rounded-md overflow-hidden border-2 transition-all ${
        selected
          ? 'border-blue-500 dark:border-blue-400 ring-2 ring-blue-200 dark:ring-blue-800'
          : 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-500'
      } ${disabled ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={src} alt="" className="w-full h-full object-cover" />
      {selected && (
        <div className="absolute inset-0 bg-blue-500 bg-opacity-20 flex items-center justify-center">
          <CheckCircle size={24} className="text-blue-600 dark:text-blue-300" />
        </div>
      )}
      {label && (
        <div className="absolute bottom-1 end-1 bg-black bg-opacity-60 text-white px-1.5 py-0.5 rounded text-xs">
          {label}
        </div>
      )}
    </button>
  );
}
