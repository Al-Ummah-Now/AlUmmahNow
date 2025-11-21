'use client';

import React, { useState, useRef, useCallback } from 'react';
import { X, Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { useLanguage } from '@/hooks/useLanguage';
import {
  SUPPORTED_LANGUAGES,
  uploadSubtitle,
  validateSubtitleFile,
  SubtitleValidationResult,
  SubtitleTrack,
} from '@/lib/api/subtitles';
import SubtitlePreview from './SubtitlePreview';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Progress } from '@/components/ui/progress';

interface SubtitleUploadModalProps {
  videoId: string;
  userId: string;
  channelId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onUploadSuccess?: (subtitle: SubtitleTrack) => void;
  existingLanguages?: string[];
}

/**
 * SubtitleUploadModal Component
 *
 * Modal for uploading subtitle files with:
 * - Language selection (10 supported languages)
 * - File upload (drag-drop or browse)
 * - File validation (format, size, cue count)
 * - Preview of first 5 cues
 * - Set as default option
 * - Upload progress
 *
 * Mobile-first responsive design with WCAG 2.1 AA accessibility.
 */
export default function SubtitleUploadModal({
  videoId,
  userId,
  channelId,
  open,
  onOpenChange,
  onUploadSuccess,
  existingLanguages = [],
}: SubtitleUploadModalProps) {
  const { t, lang } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // State
  const [selectedLanguage, setSelectedLanguage] = useState<string>('');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isDefault, setIsDefault] = useState(false);
  const [validation, setValidation] = useState<SubtitleValidationResult | null>(null);
  const [isValidating, setIsValidating] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [isDragging, setIsDragging] = useState(false);

  // Reset state when modal closes
  const handleOpenChange = useCallback((newOpen: boolean) => {
    if (!newOpen) {
      // Reset all state
      setSelectedLanguage('');
      setSelectedFile(null);
      setIsDefault(false);
      setValidation(null);
      setError(null);
      setSuccess(false);
      setUploadProgress(0);
    }
    onOpenChange(newOpen);
  }, [onOpenChange]);

  // Handle file selection
  const handleFileSelect = useCallback(async (file: File) => {
    setError(null);
    setValidation(null);
    setSelectedFile(file);
    setIsValidating(true);

    try {
      const result = await validateSubtitleFile(file);
      setValidation(result);

      if (!result.valid) {
        setError(result.errors.join(', '));
      }
    } catch (err) {
      setError(t.subtitle?.validationFailed || 'Failed to validate subtitle file');
    } finally {
      setIsValidating(false);
    }
  }, [t]);

  // Handle file input change
  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Handle drag and drop
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    const file = e.dataTransfer.files?.[0];
    if (file) {
      handleFileSelect(file);
    }
  };

  // Handle upload
  const handleUpload = async () => {
    if (!selectedFile || !selectedLanguage || !validation?.valid) {
      setError(t.subtitle?.completeAllFields || 'Please complete all fields');
      return;
    }

    setIsUploading(true);
    setError(null);
    setUploadProgress(0);

    try {
      // Simulate upload progress (replace with actual progress tracking)
      const progressInterval = setInterval(() => {
        setUploadProgress((prev) => Math.min(prev + 10, 90));
      }, 200);

      const result = await uploadSubtitle(
        videoId,
        selectedFile,
        selectedLanguage,
        isDefault,
        { userId, channelId }
      );

      clearInterval(progressInterval);
      setUploadProgress(100);

      if (result?.success && result.result?.subtitle) {
        setSuccess(true);
        onUploadSuccess?.(result.result.subtitle);

        // Close modal after 1.5 seconds
        setTimeout(() => {
          handleOpenChange(false);
        }, 1500);
      } else {
        setError(result?.error || t.subtitle?.uploadFailed || 'Failed to upload subtitle');
      }
    } catch (err) {
      setError(t.subtitle?.uploadError || 'An error occurred while uploading');
    } finally {
      setIsUploading(false);
    }
  };

  // Available languages (filter out existing)
  const availableLanguages = SUPPORTED_LANGUAGES.filter(
    (lang) => !existingLanguages.includes(lang.code)
  );

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="
        w-[calc(100%-2rem)]
        max-w-2xl
        max-h-[90vh]
        overflow-y-auto
        p-0
      ">
        <DialogHeader className="
          p-4
          md:p-6
          border-b
          dark:border-gray-700
        ">
          <DialogTitle className="
            text-lg
            md:text-xl
            font-bold
            dark:text-white
          ">
            {t.subtitle?.uploadSubtitle || 'Upload Subtitle'}
          </DialogTitle>
        </DialogHeader>

        <div className="
          p-4
          md:p-6
          space-y-4
          md:space-y-6
        ">
          {/* Language Selector */}
          <div className="space-y-2">
            <Label htmlFor="language" className="
              text-sm
              md:text-base
              font-medium
              dark:text-white
            ">
              {t.subtitle?.selectLanguage || 'Select Language'} *
            </Label>
            <Select
              value={selectedLanguage}
              onValueChange={setSelectedLanguage}
              disabled={isUploading}
            >
              <SelectTrigger
                id="language"
                className="
                  w-full
                  h-10
                  md:h-11
                  dark:bg-gray-800
                  dark:border-gray-600
                  dark:text-white
                "
              >
                <SelectValue placeholder={t.subtitle?.chooseLanguage || 'Choose a language'} />
              </SelectTrigger>
              <SelectContent className="dark:bg-gray-800 dark:border-gray-700">
                {availableLanguages.map((language) => (
                  <SelectItem
                    key={language.code}
                    value={language.code}
                    className="dark:text-white dark:focus:bg-gray-700"
                  >
                    <span className="flex items-center gap-2">
                      <span>{language.flag}</span>
                      <span>{lang === 'ar' ? language.nameAr : language.name}</span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* File Upload Area */}
          <div className="space-y-2">
            <Label className="
              text-sm
              md:text-base
              font-medium
              dark:text-white
            ">
              {t.subtitle?.subtitleFile || 'Subtitle File'} *
            </Label>

            <div
              onDragEnter={handleDragEnter}
              onDragLeave={handleDragLeave}
              onDragOver={handleDragOver}
              onDrop={handleDrop}
              className={`
                border-2
                border-dashed
                rounded-lg
                p-6
                md:p-8
                text-center
                transition-colors
                cursor-pointer
                ${isDragging
                  ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                  : 'border-gray-300 dark:border-gray-600 hover:border-blue-400 dark:hover:border-blue-500'
                }
                ${isUploading ? 'opacity-50 pointer-events-none' : ''}
              `}
              onClick={() => fileInputRef.current?.click()}
              role="button"
              tabIndex={0}
              aria-label={t.subtitle?.uploadFileArea || 'Upload subtitle file'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  fileInputRef.current?.click();
                }
              }}
            >
              <input
                ref={fileInputRef}
                type="file"
                accept=".srt,.vtt,.sbv"
                onChange={handleFileInputChange}
                className="hidden"
                disabled={isUploading}
                aria-label="File input"
              />

              {!selectedFile && (
                <div className="space-y-3">
                  <Upload className="
                    w-10 h-10
                    md:w-12 md:h-12
                    mx-auto
                    text-gray-400
                    dark:text-gray-500
                  " />
                  <div>
                    <p className="
                      text-sm
                      md:text-base
                      font-medium
                      text-gray-700
                      dark:text-gray-300
                    ">
                      {t.subtitle?.dragDropOrClick || 'Drag and drop or click to browse'}
                    </p>
                    <p className="
                      text-xs
                      md:text-sm
                      text-gray-500
                      dark:text-gray-400
                      mt-1
                    ">
                      {t.subtitle?.supportedFormats || 'Supported: SRT, VTT, SBV (Max 2MB)'}
                    </p>
                  </div>
                </div>
              )}

              {selectedFile && (
                <div className="flex items-center justify-center gap-3">
                  <FileText className="
                    w-8 h-8
                    md:w-10 md:h-10
                    text-blue-500
                  " />
                  <div className="text-left">
                    <p className="
                      text-sm
                      md:text-base
                      font-medium
                      text-gray-900
                      dark:text-gray-100
                      break-all
                    ">
                      {selectedFile.name}
                    </p>
                    <p className="
                      text-xs
                      md:text-sm
                      text-gray-600
                      dark:text-gray-400
                    ">
                      {(selectedFile.size / 1024).toFixed(1)} KB
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Validation Status */}
          {isValidating && (
            <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>{t.subtitle?.validating || 'Validating subtitle file...'}</span>
            </div>
          )}

          {/* Subtitle Preview */}
          {validation?.preview && validation.preview.length > 0 && (
            <SubtitlePreview
              cues={validation.preview}
              warnings={validation.warnings}
            />
          )}

          {/* Set as Default */}
          {selectedFile && validation?.valid && (
            <div className="flex items-center gap-3">
              <input
                type="checkbox"
                id="isDefault"
                checked={isDefault}
                onChange={(e) => setIsDefault(e.target.checked)}
                disabled={isUploading}
                className="
                  w-4 h-4
                  md:w-5 md:h-5
                  rounded
                  border-gray-300
                  dark:border-gray-600
                  text-blue-500
                  focus:ring-2
                  focus:ring-blue-500
                  dark:bg-gray-800
                "
              />
              <label
                htmlFor="isDefault"
                className="
                  text-sm
                  md:text-base
                  text-gray-700
                  dark:text-gray-300
                  cursor-pointer
                "
              >
                {t.subtitle?.setAsDefault || 'Set as default subtitle track'}
              </label>
            </div>
          )}

          {/* Upload Progress */}
          {isUploading && (
            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-600 dark:text-gray-400">
                  {t.subtitle?.uploading || 'Uploading...'}
                </span>
                <span className="font-medium text-blue-500">
                  {uploadProgress}%
                </span>
              </div>
              <Progress value={uploadProgress} className="h-2" />
            </div>
          )}

          {/* Error Message */}
          {error && (
            <div className="
              flex
              items-start
              gap-2
              p-3
              md:p-4
              bg-red-50
              dark:bg-red-900/20
              border
              border-red-200
              dark:border-red-800
              rounded-lg
            ">
              <AlertCircle className="
                w-4 h-4
                md:w-5 md:h-5
                text-red-600
                dark:text-red-400
                flex-shrink-0
                mt-0.5
              " />
              <p className="
                text-xs
                md:text-sm
                text-red-700
                dark:text-red-400
                break-words
              ">
                {error}
              </p>
            </div>
          )}

          {/* Success Message */}
          {success && (
            <div className="
              flex
              items-center
              gap-2
              p-3
              md:p-4
              bg-green-50
              dark:bg-green-900/20
              border
              border-green-200
              dark:border-green-800
              rounded-lg
            ">
              <CheckCircle className="
                w-4 h-4
                md:w-5 md:h-5
                text-green-600
                dark:text-green-400
                flex-shrink-0
              " />
              <p className="
                text-xs
                md:text-sm
                text-green-700
                dark:text-green-400
                font-medium
              ">
                {t.subtitle?.uploadSuccess || 'Subtitle uploaded successfully!'}
              </p>
            </div>
          )}

          {/* Action Buttons */}
          <div className="
            flex
            flex-col-reverse
            sm:flex-row
            gap-3
            pt-4
            border-t
            dark:border-gray-700
          ">
            <Button
              variant="outline"
              onClick={() => handleOpenChange(false)}
              disabled={isUploading}
              className="
                w-full
                sm:w-auto
                h-10
                md:h-11
                dark:border-gray-600
                dark:text-white
                dark:hover:bg-gray-800
              "
            >
              {t.common?.cancel || 'Cancel'}
            </Button>
            <Button
              onClick={handleUpload}
              disabled={
                !selectedFile ||
                !selectedLanguage ||
                !validation?.valid ||
                isUploading ||
                success
              }
              className="
                w-full
                sm:flex-1
                h-10
                md:h-11
                bg-blue-500
                hover:bg-blue-600
                text-white
                disabled:opacity-50
                disabled:cursor-not-allowed
              "
            >
              {isUploading ? (
                <span className="flex items-center gap-2">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  {t.subtitle?.uploading || 'Uploading...'}
                </span>
              ) : (
                t.subtitle?.upload || 'Upload'
              )}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
