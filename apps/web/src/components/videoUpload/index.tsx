"use client";
import React, { useState, useRef, useCallback } from "react";
import * as tus from "tus-js-client";
import { VideoObject } from "@/interfaces";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useActiveChannel } from "@/contexts/ActiveChannelContext";
import { VIDEO_UPLOAD_CONFIG, VIDEO_UPLOAD_ERRORS } from "@/lib/constants/uploadConfig";
import { Upload, X, AlertCircle, Pause, Play, RotateCcw } from "lucide-react";
import { initiateVideoUpload, completeVideoUpload, getVideoUploadStatus } from "@/lib/actions/upload";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";
import { UploadButton } from "@/components/UploadButton";
import { ThumbnailUploadSection, ThumbnailData } from "./ThumbnailUploadSection";
import { CategorySelector } from "./CategorySelector";
import { TemplateSelector } from "./TemplateSelector";
import { ScheduleDateTimeSelector, ScheduleData } from "./ScheduleDateTimeSelector";
import { VideoCategory } from "@al-ummah/shared-types";
import type { ProcessedMetadata } from "@/lib/upload/template-variables";
import { scheduleVideo } from "@/lib/api/scheduling";

interface VideoUploadProps {
  onUploadComplete: (video: VideoObject) => void;
  onProgress: (percentage: number) => void;
  onError: (error: string) => void;
  className?: string;
}

interface VideoMetadata {
  title: string;
  titleEn: string;
  titleAr: string;
  description?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  tags?: string[];
  category?: VideoCategory;
  isPublic: boolean;
}

type UploadState = 'idle' | 'uploading' | 'paused' | 'processing' | 'complete' | 'error';

interface UploadProgress {
  percentage: number;
  state: UploadState;
  error?: string;
  speed?: number; // bytes per second
  bytesUploaded?: number;
  bytesTotal?: number;
  timeRemaining?: number; // seconds
}

const VideoUpload: React.FC<VideoUploadProps> = ({
  onUploadComplete,
  onProgress,
  onError,
  className = ""
}) => {
  const pathname = usePathname();
  const locale = pathname?.startsWith('/ar') ? 'ar' : 'en';
  const { t } = useI18n(locale);

  const [isDragOver, setIsDragOver] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState<UploadProgress | null>(null);
  const [metadata, setMetadata] = useState<VideoMetadata>({
    title: '',
    titleEn: '',
    titleAr: '',
    description: '',
    descriptionEn: '',
    descriptionAr: '',
    tags: [],
    isPublic: true
  });
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [selectedThumbnail, setSelectedThumbnail] = useState<ThumbnailData | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tusUploadRef = useRef<tus.Upload | null>(null);
  const uploadStartTimeRef = useRef<number>(0);
  const lastProgressTimeRef = useRef<number>(0);
  const lastBytesUploadedRef = useRef<number>(0);
  const videoIdRef = useRef<string>('');
  const libraryIdRef = useRef<number>(0);
  const thumbnailUrlRef = useRef<string>('');

  const auth = useAuth();
  const { activeChannel } = useActiveChannel();

  // File validation
  const validateFile = (file: File): string | null => {
    type VideoMimeType = 'video/mp4' | 'video/mov' | 'video/avi' | 'video/webm';
    if (!VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.type as VideoMimeType)) {
      return VIDEO_UPLOAD_ERRORS.INVALID_TYPE;
    }

    if (file.size > VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE) {
      return VIDEO_UPLOAD_ERRORS.FILE_TOO_LARGE;
    }

    return null;
  };

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleFileSelection = useCallback((file: File) => {
    const validationError = validateFile(file);
    if (validationError) {
      onError(validationError);
      return;
    }

    setSelectedFile(file);
    const defaultTitle = file.name.replace(/\.[^/.]+$/, ""); // Remove extension
    setMetadata(prev => ({
      ...prev,
      title: defaultTitle,
      titleEn: defaultTitle,
      titleAr: ''
    }));
    setShowMetadataForm(true);
  }, [onError]);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    if (files.length > 0) {
      handleFileSelection(files[0]);
    }
  }, [handleFileSelection]);

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelection(files[0]);
    }
  };

  const formatBytes = (bytes: number): string => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return `${(bytes / Math.pow(k, i)).toFixed(2)} ${sizes[i]}`;
  };

  const formatTime = (seconds: number): string => {
    if (!isFinite(seconds) || seconds < 0) return '--:--';
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const uploadVideo = async () => {
    if (!selectedFile) return;

    // Check authentication
    if (!auth.user) {
      onError(VIDEO_UPLOAD_ERRORS.AUTH_REQUIRED);
      return;
    }

    // Check active channel
    if (!activeChannel) {
      onError('No active channel selected. Please select a channel first.');
      return;
    }

    // Extract userId and channelId after auth check
    const userId = auth.user.id;
    const channelId = activeChannel.channelId;

    try {
      // Step 1: Initiate upload and get TUS configuration
      setUploadProgress({ percentage: 5, state: 'uploading' });
      onProgress(5);

      const tagsString = metadata.tags?.join(',') || '';
      const initiateResult = await initiateVideoUpload(
        {
          title: metadata.titleEn || metadata.title,
          titleLocalized: {
            en: metadata.titleEn,
            ar: metadata.titleAr
          },
          description: metadata.descriptionEn || metadata.description,
          descriptionLocalized: {
            en: metadata.descriptionEn || '',
            ar: metadata.descriptionAr || ''
          },
          isPublic: metadata.isPublic,
          tags: tagsString,
          category: metadata.category,
          fileSize: selectedFile.size,
          mimeType: selectedFile.type,
          thumbnail: selectedThumbnail ? {
            type: selectedThumbnail.type,
            data: selectedThumbnail.data,
            position: selectedThumbnail.position,
            filename: selectedThumbnail.filename,
          } : undefined,
        },
        userId,
        channelId
      );

      if (!initiateResult.success || !initiateResult.result) {
        throw new Error(initiateResult.error || VIDEO_UPLOAD_ERRORS.UPLOAD_FAILED);
      }

      const { videoId, tusSessionId, libraryId, authToken, thumbnailUrl: returnedThumbnailUrl } = initiateResult.result;
      videoIdRef.current = videoId;
      libraryIdRef.current = libraryId || 0;
      thumbnailUrlRef.current = returnedThumbnailUrl || '';

      if (!tusSessionId) {
        throw new Error('TUS session ID not received from server');
      }

      if (!authToken) {
        throw new Error('Authentication token not found. Please log in again.');
      }

      // Step 2: Create TUS upload using secure proxy endpoint
      uploadStartTimeRef.current = Date.now();
      lastProgressTimeRef.current = Date.now();
      lastBytesUploadedRef.current = 0;

      const upload = new tus.Upload(selectedFile, {
        // Use TUS proxy endpoint (NOT Bunny.net directly)
        endpoint: `${process.env.NEXT_PUBLIC_API_URL}/api/videos/tus`,
        retryDelays: [0, 3000, 5000, 10000, 20000],
        chunkSize: 5 * 1024 * 1024, // 5MB chunks
        // Include Authorization header since cookies don't cross origins
        headers: {
          'Authorization': `Bearer ${authToken}`
        },
        storeFingerprintForResuming: true,
        removeFingerprintOnSuccess: true,
        metadata: {
          tusSessionId: tusSessionId, // Session ID for TUS proxy to retrieve credentials
          videoId: videoId,
          filename: selectedFile.name,
          filetype: selectedFile.type,
        },
        onError: (error) => {
          console.error('TUS upload error:', error);
          setUploadProgress({
            percentage: uploadProgress?.percentage || 0,
            state: 'error',
            error: error.message || 'Upload failed',
          });
          onError(error.message || 'Upload failed');
        },
        onProgress: (bytesUploaded, bytesTotal) => {
          const percent = Math.round((bytesUploaded / bytesTotal) * 100);
          const adjustedPercent = Math.min(percent * 0.7, 70); // Map to 0-70%

          // Calculate upload speed
          const now = Date.now();
          const timeDelta = (now - lastProgressTimeRef.current) / 1000; // seconds
          const bytesDelta = bytesUploaded - lastBytesUploadedRef.current;

          let speed = 0;
          let timeRemaining = 0;

          if (timeDelta > 0.5) { // Update every 0.5 seconds
            speed = bytesDelta / timeDelta; // bytes per second
            const bytesRemaining = bytesTotal - bytesUploaded;
            timeRemaining = speed > 0 ? bytesRemaining / speed : 0;

            lastProgressTimeRef.current = now;
            lastBytesUploadedRef.current = bytesUploaded;
          } else {
            // Use previous speed calculation
            const totalTime = (now - uploadStartTimeRef.current) / 1000;
            speed = totalTime > 0 ? bytesUploaded / totalTime : 0;
            const bytesRemaining = bytesTotal - bytesUploaded;
            timeRemaining = speed > 0 ? bytesRemaining / speed : 0;
          }

          setUploadProgress({
            percentage: adjustedPercent,
            state: 'uploading',
            speed,
            bytesUploaded,
            bytesTotal,
            timeRemaining,
          });
          onProgress(adjustedPercent);
        },
        onSuccess: async () => {
          setUploadProgress({ percentage: 75, state: 'processing' });
          onProgress(75);

          // Step 3: Complete upload
          const completeResult = await completeVideoUpload(
            videoId,
            userId,
            channelId,
            selectedFile.size,
            undefined // Duration will be detected by Bunny.net
          );

          if (!completeResult.success) {
            throw new Error(completeResult.error || 'Failed to complete upload');
          }

          // Step 4: Poll for processing status
          let pollCount = 0;
          const maxPolls = VIDEO_UPLOAD_CONFIG.POLLING.MAX_POLLS;

          while (pollCount < maxPolls) {
            const statusResult = await getVideoUploadStatus(videoId, userId, channelId);

            if (statusResult.success && statusResult.result) {
              const { status, progress: encodingProgress } = statusResult.result;

              const overallProgress = 75 + (encodingProgress * 0.25);
              setUploadProgress({ percentage: overallProgress, state: 'processing' });
              onProgress(overallProgress);

              if (status === 'ready') {
                break;
              } else if (status === 'failed') {
                throw new Error('Video processing failed');
              }
            }

            await new Promise(resolve => setTimeout(resolve, VIDEO_UPLOAD_CONFIG.POLLING.INTERVAL_MS));
            pollCount++;
          }

          setUploadProgress({ percentage: 100, state: 'complete' });
          onProgress(100);

          // If scheduled, create schedule after upload
          if (scheduleData) {
            try {
              const scheduleResult = await scheduleVideo(
                videoId,
                scheduleData.scheduledPublishDate,
                scheduleData.timezone,
                scheduleData.notifyOnPublish,
                { userId, channelId }
              );

              if (!scheduleResult?.success) {
                console.warn('Failed to schedule video:', scheduleResult?.error);
                // Continue anyway - video is uploaded successfully
              }
            } catch (schedError) {
              console.warn('Error scheduling video:', schedError);
              // Continue anyway - video is uploaded successfully
            }
          }

          // Create video object for callback
          const videoData: VideoObject = {
            id: videoId,
            title: metadata.title,
            description: metadata.description || null,
            thumbnailUrl: thumbnailUrlRef.current,
            videoUrl: `${VIDEO_UPLOAD_CONFIG.BUNNY_CDN_BASE_URL}/library/${libraryIdRef.current}/videos/${videoId}`,
            userId: userId,
            channel: channelId,
            channelId: channelId,
            channelAvatarUrl: activeChannel.avatarUrl || '',
            channelName: activeChannel.name || auth.user?.email || 'Unknown',
            dateCreated: new Date().toISOString(),
            dateModified: new Date().toISOString(),
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
            views: 0,
            availableResolutions: [],
            likesCount: 0,
            dislikesCount: 0,
            commentsCount: 0,
            comments: [],
            likes: [],
            dislikes: [],
            isPublic: metadata.isPublic,
            isLive: false,
          };

          // Reset form
          resetForm();
          onUploadComplete(videoData);
        },
      });

      tusUploadRef.current = upload;
      upload.start();

    } catch (error: unknown) {
      const err = error as { message?: string };
      const errorMessage = err.message || 'Upload failed. Please try again.';
      setUploadProgress({
        percentage: uploadProgress?.percentage || 0,
        state: 'error',
        error: errorMessage
      });
      onError(errorMessage);
    }
  };

  const pauseUpload = () => {
    if (tusUploadRef.current) {
      tusUploadRef.current.abort();
      setUploadProgress(prev => prev ? { ...prev, state: 'paused' } : null);
    }
  };

  const resumeUpload = () => {
    if (tusUploadRef.current) {
      tusUploadRef.current.start();
      setUploadProgress(prev => prev ? { ...prev, state: 'uploading' } : null);
    }
  };

  const cancelUpload = () => {
    if (tusUploadRef.current) {
      tusUploadRef.current.abort(true); // Remove fingerprint
      tusUploadRef.current = null;
    }
    resetForm();
  };

  const retryUpload = () => {
    setUploadProgress(null);
    uploadVideo();
  };

  const resetForm = () => {
    setSelectedFile(null);
    setShowMetadataForm(false);
    setUploadProgress(null);
    tusUploadRef.current = null;
    videoIdRef.current = '';
    libraryIdRef.current = 0;
    setSelectedThumbnail(null);
    setScheduleData(null);
    setMetadata({
      title: '',
      titleEn: '',
      titleAr: '',
      description: '',
      descriptionEn: '',
      descriptionAr: '',
      tags: [],
      isPublic: true
    });
  };

  const handleTemplateApply = (processedMetadata: ProcessedMetadata) => {
    setMetadata(prev => ({
      ...prev,
      titleEn: processedMetadata.titleLocalized?.en || processedMetadata.title || prev.titleEn,
      titleAr: processedMetadata.titleLocalized?.ar || prev.titleAr,
      title: processedMetadata.title || prev.title,
      descriptionEn: processedMetadata.descriptionLocalized?.en || processedMetadata.description || prev.descriptionEn,
      descriptionAr: processedMetadata.descriptionLocalized?.ar || prev.descriptionAr,
      description: processedMetadata.description || prev.description,
      tags: processedMetadata.tags || prev.tags,
      category: processedMetadata.category || prev.category,
      isPublic: processedMetadata.visibility === 'public' ? true : processedMetadata.visibility === 'private' ? false : prev.isPublic,
    }));
  };

  if (showMetadataForm && selectedFile) {
    return (
      <div className={`bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg ${className}`}>
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t.upload.videoDetails}
          </h3>
          <button
            onClick={resetForm}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={uploadProgress?.state === 'uploading'}
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{t.upload.selectFile}:</p>
          <p className="font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
          <p className="text-sm text-gray-500">
            {formatBytes(selectedFile.size)}
          </p>
        </div>

        {uploadProgress && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {uploadProgress.state === 'uploading' && t.upload.uploading}
                {uploadProgress.state === 'paused' && t.upload.paused}
                {uploadProgress.state === 'processing' && t.upload.processingVideo}
                {uploadProgress.state === 'complete' && t.upload.uploadComplete}
                {uploadProgress.state === 'error' && t.upload.uploadFailed}
              </span>
              <span className="text-sm text-gray-500">{uploadProgress.percentage.toFixed(0)}%</span>
            </div>

            <div className="w-full bg-gray-200 rounded-full h-2 mb-2">
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  uploadProgress.state === 'error'
                    ? 'bg-red-600'
                    : uploadProgress.state === 'complete'
                    ? 'bg-green-600'
                    : uploadProgress.state === 'paused'
                    ? 'bg-yellow-600'
                    : 'bg-blue-600'
                }`}
                style={{ width: `${uploadProgress.percentage}%` }}
              ></div>
            </div>

            {/* Upload stats */}
            {uploadProgress.state === 'uploading' && uploadProgress.bytesUploaded && uploadProgress.bytesTotal && (
              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  {t.upload.bytesUploaded}: {formatBytes(uploadProgress.bytesUploaded)} / {formatBytes(uploadProgress.bytesTotal)}
                </span>
                {uploadProgress.speed && (
                  <span>
                    {t.upload.speed}: {formatBytes(uploadProgress.speed)}/s
                  </span>
                )}
                {uploadProgress.timeRemaining && (
                  <span>
                    {t.upload.timeRemaining}: {formatTime(uploadProgress.timeRemaining)}
                  </span>
                )}
              </div>
            )}

            {uploadProgress.error && (
              <div className="flex items-center mt-2 text-red-600">
                <AlertCircle size={16} className="mr-1" />
                <span className="text-sm">{uploadProgress.error}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4 mb-6">
          {/* Template Selector */}
          <TemplateSelector
            onTemplateApply={handleTemplateApply}
            channelName={auth.user?.channelName || auth.user?.email}
            uploaderName={auth.user?.name || auth.user?.email}
          />

          {/* Title with Language Tabs */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t.video.videoTitle} *
            </label>
            <div className="flex gap-2 mb-2">
              <button
                type="button"
                onClick={() => setActiveTab('en')}
                className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                  activeTab === 'en'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
                disabled={uploadProgress?.state === 'uploading'}
              >
                English
              </button>
              <button
                type="button"
                onClick={() => setActiveTab('ar')}
                className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                  activeTab === 'ar'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-300 dark:hover:bg-gray-600'
                }`}
                disabled={uploadProgress?.state === 'uploading'}
              >
                العربية
              </button>
            </div>
            {activeTab === 'en' && (
              <input
                type="text"
                value={metadata.titleEn}
                onChange={(e) => setMetadata(prev => ({ ...prev, titleEn: e.target.value, title: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="Title in English"
                required
                disabled={uploadProgress?.state === 'uploading'}
              />
            )}
            {activeTab === 'ar' && (
              <input
                type="text"
                value={metadata.titleAr}
                onChange={(e) => setMetadata(prev => ({ ...prev, titleAr: e.target.value }))}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="العنوان بالعربية"
                dir="rtl"
                disabled={uploadProgress?.state === 'uploading'}
              />
            )}
          </div>

          {/* Description with Language Tabs */}
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t.video.videoDescription}
            </label>
            {activeTab === 'en' && (
              <textarea
                value={metadata.descriptionEn}
                onChange={(e) => setMetadata(prev => ({ ...prev, descriptionEn: e.target.value, description: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="Description in English"
                disabled={uploadProgress?.state === 'uploading'}
              />
            )}
            {activeTab === 'ar' && (
              <textarea
                value={metadata.descriptionAr}
                onChange={(e) => setMetadata(prev => ({ ...prev, descriptionAr: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder="الوصف بالعربية"
                dir="rtl"
                disabled={uploadProgress?.state === 'uploading'}
              />
            )}
          </div>

          {/* Category Selector */}
          <CategorySelector
            value={metadata.category}
            onChange={(category) => setMetadata(prev => ({ ...prev, category }))}
            disabled={uploadProgress?.state === 'uploading'}
          />

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isPublic"
              checked={metadata.isPublic}
              onChange={(e) => setMetadata(prev => ({ ...prev, isPublic: e.target.checked }))}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={uploadProgress?.state === 'uploading'}
            />
            <label htmlFor="isPublic" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              {t.upload.makePublic}
            </label>
          </div>

          {/* Thumbnail Upload Section */}
          <ThumbnailUploadSection
            videoFile={selectedFile}
            onThumbnailSelect={setSelectedThumbnail}
            disabled={uploadProgress?.state === 'uploading'}
          />

          {/* Schedule Selector - Only show when NOT public */}
          {!metadata.isPublic && (
            <ScheduleDateTimeSelector
              onScheduleChange={setScheduleData}
              disabled={uploadProgress?.state === 'uploading'}
            />
          )}
        </div>

        <div className="flex space-x-3">
          {!uploadProgress || uploadProgress.state === 'idle' ? (
            <>
              <UploadButton
                onClick={uploadVideo}
                text={t.upload.uploadTitle}
                disabled={!metadata.titleEn.trim()}
                className="flex-1"
                showIcon={false}
              />
              <button
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t.common.cancel}
              </button>
            </>
          ) : uploadProgress.state === 'uploading' ? (
            <>
              <button
                onClick={pauseUpload}
                className="flex-1 bg-yellow-600 text-white px-4 py-2 rounded-md hover:bg-yellow-700 focus:outline-none focus:ring-2 focus:ring-yellow-500 font-medium flex items-center justify-center gap-2"
              >
                <Pause size={16} />
                {t.upload.pause}
              </button>
              <button
                onClick={cancelUpload}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
              >
                {t.upload.cancel}
              </button>
            </>
          ) : uploadProgress.state === 'paused' ? (
            <>
              <button
                onClick={resumeUpload}
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium flex items-center justify-center gap-2"
              >
                <Play size={16} />
                {t.upload.resume}
              </button>
              <button
                onClick={cancelUpload}
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
              >
                {t.upload.cancel}
              </button>
            </>
          ) : uploadProgress.state === 'error' ? (
            <>
              <button
                onClick={retryUpload}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} />
                {t.upload.retry}
              </button>
              <button
                onClick={resetForm}
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t.common.cancel}
              </button>
            </>
          ) : (
            <button
              onClick={resetForm}
              disabled={uploadProgress.state === 'processing'}
              className="flex-1 bg-gray-600 text-white px-4 py-2 rounded-md hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500 font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {t.common.close}
            </button>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className={className}>
      <div
        className={`relative border-2 border-dashed rounded-lg p-12 text-center transition-colors ${
          isDragOver
            ? 'border-blue-400 bg-blue-50 dark:bg-blue-900/20'
            : 'border-gray-300 dark:border-gray-600 hover:border-gray-400 dark:hover:border-gray-500'
        }`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          multiple={false}
        />

        <div className="flex flex-col items-center">
          <Upload
            size={48}
            className={`mb-4 ${
              isDragOver ? 'text-blue-500' : 'text-gray-400 dark:text-gray-500'
            }`}
          />
          <h3 className="text-lg font-medium text-gray-900 dark:text-white mb-2">
            {isDragOver ? t.upload.dropHere : t.upload.uploadTitle}
          </h3>
          <p className="text-gray-600 dark:text-gray-400 mb-4">
            {t.upload.dragDropFiles}
          </p>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            {t.upload.supports} {VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY} • {t.upload.max} {VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE_DISPLAY} • {t.upload.max} {VIDEO_UPLOAD_CONFIG.MAX_DURATION_DISPLAY}
          </p>
        </div>
      </div>
    </div>
  );
};

export default VideoUpload;
