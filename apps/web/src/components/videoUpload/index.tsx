"use client";
import React, { useState, useRef, useCallback } from "react";
import { VideoObject } from "@/interfaces";
import { useAuth } from "@/components/AuthProvider/authContext";
import { VIDEO_UPLOAD_CONFIG, VIDEO_UPLOAD_ERRORS } from "@/lib/constants/uploadConfig";
import { Upload, X, AlertCircle } from "lucide-react";
import { initiateVideoUpload, completeVideoUpload, getVideoUploadStatus, getBunnyAccessKey } from "@/lib/actions/upload";
import { usePathname } from "next/navigation";
import { useI18n } from "@/lib/i18n";

interface VideoUploadProps {
  onUploadComplete: (video: VideoObject) => void;
  onProgress: (percentage: number) => void;
  onError: (error: string) => void;
  className?: string;
}

interface VideoMetadata {
  title: string;
  description?: string;
  tags?: string[];
  isPublic: boolean;
}

interface UploadProgress {
  percentage: number;
  stage: 'preparing' | 'uploading' | 'processing' | 'complete';
  error?: string;
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
    description: '',
    tags: [],
    isPublic: true
  });
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const abortControllerRef = useRef<AbortController | null>(null);
  const auth = useAuth();

  // File validation
  const validateFile = (file: File): string | null => {
    if (!VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.type as unknown)) {
      return VIDEO_UPLOAD_ERRORS.INVALID_TYPE;
    }

    if (file.size > VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE) {
      return VIDEO_UPLOAD_ERRORS.FILE_TOO_LARGE;
    }

    // TODO: Add duration validation when we can read video metadata
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
    setMetadata(prev => ({
      ...prev,
      title: file.name.replace(/\.[^/.]+$/, "") // Remove extension for default title
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

  const uploadVideo = async () => {
    if (!selectedFile) return;

    // Check authentication
    if (!auth.user) {
      onError(VIDEO_UPLOAD_ERRORS.AUTH_REQUIRED);
      return;
    }

    const controller = new AbortController();
    abortControllerRef.current = controller;

    try {
      // Step 1: Initiate upload
      setUploadProgress({ percentage: 5, stage: 'preparing' });
      onProgress(5);

      const tagsString = metadata.tags?.join(',') || '';
      const initiateResult = await initiateVideoUpload({
        title: metadata.title,
        description: metadata.description,
        isPublic: metadata.isPublic,
        tags: tagsString,
      });

      if (!initiateResult.success || !initiateResult.result) {
        throw new Error(initiateResult.error || VIDEO_UPLOAD_ERRORS.UPLOAD_FAILED);
      }

      const { videoId, uploadUrl, libraryId } = initiateResult.result;

      // Step 2: Upload file directly to Bunny.net
      setUploadProgress({ percentage: 10, stage: 'uploading' });
      onProgress(10);

      // Get Bunny.net access key from server
      const keyResult = await getBunnyAccessKey();
      
      if (!keyResult.success || !keyResult.accessKey) {
        throw new Error(keyResult.error || "Failed to get Bunny access key");
      }

      const bunnyKey = keyResult.accessKey;

      // Upload directly to Bunny.net with progress tracking
      const xhr = new XMLHttpRequest();
      
      const uploadPromise = new Promise<void>((resolve, reject) => {
        xhr.upload.addEventListener('progress', (e) => {
          if (e.lengthComputable) {
            const percentComplete = Math.round((e.loaded / e.total) * 100);
            const adjustedPercent = 10 + (percentComplete * 0.6); // Map to 10-70%
            setUploadProgress({ percentage: adjustedPercent, stage: 'uploading' });
            onProgress(adjustedPercent);
          }
        });

        xhr.addEventListener('load', () => {
          if (xhr.status >= 200 && xhr.status < 300) {
            resolve();
          } else {
            reject(new Error(`Upload failed with status ${xhr.status}`));
          }
        });

        xhr.addEventListener('error', () => {
          reject(new Error('Network error during upload'));
        });

        xhr.addEventListener('abort', () => {
          reject(new Error('Upload cancelled'));
        });

        xhr.open('PUT', uploadUrl);
        xhr.setRequestHeader('AccessKey', bunnyKey);
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.send(selectedFile);
      });

      // Handle abort
      controller.signal.addEventListener('abort', () => {
        xhr.abort();
      });

      await uploadPromise;

      // Step 3: Complete upload
      setUploadProgress({ percentage: 75, stage: 'processing' });
      onProgress(75);

      const completeResult = await completeVideoUpload(
        videoId,
        selectedFile.size,
        undefined // Duration will be detected by Bunny.net
      );

      if (!completeResult.success) {
        throw new Error(completeResult.error || 'Failed to complete upload');
      }

      // Step 4: Poll for processing status
      setUploadProgress({ percentage: 85, stage: 'processing' });
      onProgress(85);

      // Poll status until ready or timeout
      let pollCount = 0;
      const maxPolls = VIDEO_UPLOAD_CONFIG.POLLING.MAX_POLLS;

      while (pollCount < maxPolls) {
        const statusResult = await getVideoUploadStatus(videoId);
        
        if (statusResult.success && statusResult.result) {
          const { status, progress: encodingProgress } = statusResult.result;
          
          // Update progress based on encoding status
          const overallProgress = 85 + (encodingProgress * 0.15);
          setUploadProgress({ percentage: overallProgress, stage: 'processing' });
          onProgress(overallProgress);

          if (status === 'ready') {
            break;
          } else if (status === 'failed') {
            throw new Error('Video processing failed');
          }
        }

        // Wait before next poll
        await new Promise(resolve => setTimeout(resolve, VIDEO_UPLOAD_CONFIG.POLLING.INTERVAL_MS));
        pollCount++;
      }

      setUploadProgress({ percentage: 100, stage: 'complete' });
      onProgress(100);

      // Reset form
      setSelectedFile(null);
      setShowMetadataForm(false);
      setUploadProgress(null);
      setMetadata({
        title: '',
        description: '',
        tags: [],
        isPublic: true
      });

      // Create a video object for the callback
      const videoData: VideoObject = {
        id: videoId,
        title: metadata.title,
        description: metadata.description || null,
        thumbnailUrl: '',
        videoUrl: `${VIDEO_UPLOAD_CONFIG.BUNNY_CDN_BASE_URL}/library/${libraryId}/videos/${videoId}`,
        userId: auth.user.id,
        channel: auth.user.id, // Using user ID as channel for now
        channelId: auth.user.id,
        channelAvatarUrl: '',
        channelName: auth.user.email || 'Unknown',
        dateCreated: new Date().toISOString(),
        dateModified: new Date().toISOString(),
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

      onUploadComplete(videoData);
    } catch (error: unknown) {
      const err = error as { name?: string; message?: string };
      if (err.name === 'AbortError' || err.message === 'Upload cancelled') {
        setUploadProgress(null);
        return;
      }

      const errorMessage = err.message || 'Upload failed. Please try again.';
      setUploadProgress({ percentage: 0, stage: 'preparing', error: errorMessage });
      onError(errorMessage);
    }
  };

  const cancelUpload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    setUploadProgress(null);
    setSelectedFile(null);
    setShowMetadataForm(false);
  };

  const resetForm = () => {
    setSelectedFile(null);
    setShowMetadataForm(false);
    setUploadProgress(null);
    setMetadata({
      title: '',
      description: '',
      tags: [],
      isPublic: true
    });
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
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{t.upload.selectFile}:</p>
          <p className="font-medium text-gray-900 dark:text-white">{selectedFile.name}</p>
          <p className="text-sm text-gray-500">
            {(selectedFile.size / 1024 / 1024).toFixed(2)} MB
          </p>
        </div>

        {uploadProgress && (
          <div className="mb-6">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
                {uploadProgress.stage === 'preparing' && t.upload.preparing}
                {uploadProgress.stage === 'uploading' && t.upload.uploading}
                {uploadProgress.stage === 'processing' && t.upload.processingVideo}
                {uploadProgress.stage === 'complete' && t.upload.uploadComplete}
              </span>
              <span className="text-sm text-gray-500">{uploadProgress.percentage}%</span>
            </div>
            <div className="w-full bg-gray-200 rounded-full h-2">
              <div
                className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                style={{ width: `${uploadProgress.percentage}%` }}
              ></div>
            </div>
            {uploadProgress.error && (
              <div className="flex items-center mt-2 text-red-600">
                <AlertCircle size={16} className="mr-1" />
                <span className="text-sm">{uploadProgress.error}</span>
              </div>
            )}
          </div>
        )}

        <div className="space-y-4 mb-6">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t.video.videoTitle} *
            </label>
            <input
              type="text"
              value={metadata.title}
              onChange={(e) => setMetadata(prev => ({ ...prev, title: e.target.value }))}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder={t.video.videoTitle}
              required
              disabled={!!uploadProgress}
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
              {t.video.videoDescription}
            </label>
            <textarea
              value={metadata.description}
              onChange={(e) => setMetadata(prev => ({ ...prev, description: e.target.value }))}
              rows={3}
              className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
              placeholder={t.video.videoDescription}
              disabled={!!uploadProgress}
            />
          </div>

          <div className="flex items-center">
            <input
              type="checkbox"
              id="isPublic"
              checked={metadata.isPublic}
              onChange={(e) => setMetadata(prev => ({ ...prev, isPublic: e.target.checked }))}
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
              disabled={!!uploadProgress}
            />
            <label htmlFor="isPublic" className="ml-2 block text-sm text-gray-700 dark:text-gray-300">
              {t.upload.makePublic}
            </label>
          </div>
        </div>

        <div className="flex space-x-3">
          {!uploadProgress ? (
            <>
              <button
                onClick={uploadVideo}
                disabled={!metadata.title.trim()}
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 disabled:opacity-50 disabled:cursor-not-allowed font-medium"
              >
                {t.upload.uploadTitle}
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
              onClick={cancelUpload}
              className="flex-1 bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
            >
              {t.upload.cancelUpload}
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