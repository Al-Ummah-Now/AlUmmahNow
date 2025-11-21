"use client";
import React, { useState, useCallback, useRef } from "react";
import { VideoObject } from "@/interfaces";
import VideoUpload from "@/components/videoUpload";
import { BatchUploadQueue } from "@/components/videoUpload/BatchUploadQueue";
import { useRouter, useParams } from "next/navigation";
import { CheckCircle, AlertCircle, Upload, FileVideo, FileStack } from "lucide-react";
import { VIDEO_UPLOAD_CONFIG } from "@/lib/constants/uploadConfig";
import { useLanguage } from "@/hooks/useLanguage";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useBatchUpload } from "@/hooks/useBatchUpload";

type UploadMode = 'single' | 'batch';

const UploadPage: React.FC = () => {
  const { t } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  const auth = useAuth();
  const router = useRouter();

  const [uploadMode, setUploadMode] = useState<UploadMode>('single');
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadedVideo, setUploadedVideo] = useState<VideoObject | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);

  // Batch upload hook
  const {
    files,
    overallProgress,
    isUploading,
    isInitiating,
    addFiles,
    removeFile,
    startUpload,
    pauseUpload,
    resumeUpload,
    cancelUpload,
    retryUpload,
    pauseAll,
    resumeAll,
    cancelAll,
    clearQueue,
  } = useBatchUpload({
    userId: auth.user?.id || '',
    channelId: auth.user?.id || '',
    onUploadComplete: (videoId) => {
      console.log('Video uploaded:', videoId);
    },
    onError: (error) => {
      setUploadError(error);
    },
  });

  const handleUploadComplete = (video: VideoObject) => {
    setUploadedVideo(video);
    setUploadComplete(true);
    setUploadError(null);
  };

  const handleUploadProgress = (percentage: number) => {
    setUploadProgress(percentage);
  };

  const handleUploadError = (error: string) => {
    setUploadError(error);
    setUploadComplete(false);
  };

  const handleViewVideo = () => {
    if (uploadedVideo) {
      router.push(`/${locale}/video/${uploadedVideo.id}`);
    }
  };

  const handleUploadAnother = () => {
    setUploadComplete(false);
    setUploadedVideo(null);
    setUploadError(null);
    setUploadProgress(0);
  };

  const handleModeChange = (mode: UploadMode) => {
    setUploadMode(mode);
    setUploadError(null);
    setUploadProgress(0);
    if (mode === 'batch') {
      clearQueue();
    }
  };

  const handleBatchFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFiles = Array.from(e.target.files || []);
    if (selectedFiles.length === 0) return;

    // Validate file count
    const MIN_FILES = 1;
    const MAX_FILES = 15;

    if (selectedFiles.length < MIN_FILES) {
      setUploadError(t.batch.errors.tooFewFiles);
      return;
    }

    if (selectedFiles.length > MAX_FILES) {
      setUploadError(
        t.batch.errors.tooManyFiles
          .replace('{count}', selectedFiles.length.toString())
      );
      return;
    }

    // Validate file types
    const invalidFiles = selectedFiles.filter(
      file => !VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.type as any)
    );
    if (invalidFiles.length > 0) {
      setUploadError(
        t.batch.errors.invalidFileType.replace('{filename}', invalidFiles[0].name)
      );
      return;
    }

    // Add files to queue
    await addFiles(selectedFiles);

    // Reset input
    if (e.target) {
      e.target.value = '';
    }
  }, [addFiles, t]);

  return (
    <main className="flex flex-col p-4 md:p-6 lg:p-8 w-full min-h-screen bg-gray-50 dark:bg-gray-900">
      <div className="max-w-6xl mx-auto w-full">
        {/* Header */}
        <div className="mb-6 md:mb-8">
          <h1 className="text-2xl md:text-3xl font-bold text-gray-900 dark:text-white mb-2">
            {t.upload.uploadTitle}
          </h1>
          <p className="text-sm md:text-base text-gray-600 dark:text-gray-400">
            {t.upload.shareWithCommunity || `Share your content with the ${t.common.appName} community`}
          </p>
        </div>

        {/* Upload Mode Toggle */}
        {!uploadComplete && (
          <div className="mb-6">
            <div className="inline-flex rounded-lg border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-800">
              <button
                onClick={() => handleModeChange('single')}
                className={`
                  flex items-center gap-2
                  px-3 py-2
                  md:px-4 md:py-2.5
                  text-sm font-medium
                  rounded-md
                  transition-colors
                  ${
                    uploadMode === 'single'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                `}
              >
                <FileVideo size={18} />
                <span className="hidden sm:inline">{t.upload.uploadVideo}</span>
              </button>
              <button
                onClick={() => handleModeChange('batch')}
                className={`
                  flex items-center gap-2
                  px-3 py-2
                  md:px-4 md:py-2.5
                  text-sm font-medium
                  rounded-md
                  transition-colors
                  ${
                    uploadMode === 'batch'
                      ? 'bg-blue-600 text-white'
                      : 'text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700'
                  }
                `}
              >
                <FileStack size={18} />
                <span className="hidden sm:inline">{t.batch.batchUpload}</span>
              </button>
            </div>
          </div>
        )}

        {/* Upload Success State */}
        {uploadComplete && uploadedVideo && (
          <div className="mb-8 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 md:p-6">
            <div className="flex items-start">
              <CheckCircle className="h-6 w-6 text-green-500 mt-1 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-base md:text-lg font-medium text-green-800 dark:text-green-200 mb-2">
                  {t.upload.uploadComplete}!
                </h3>
                <p className="text-sm md:text-base text-green-700 dark:text-green-300 mb-4">
                  {t.upload.videoUploadedMessage || `Your video "${uploadedVideo.title}" has been uploaded and is now being processed.`}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    onClick={handleViewVideo}
                    className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium text-sm"
                  >
                    {t.upload.viewVideo || 'View Video'}
                  </button>
                  <button
                    onClick={handleUploadAnother}
                    className="bg-white dark:bg-gray-800 text-green-600 dark:text-green-400 px-4 py-2 rounded-md border border-green-600 dark:border-green-400 hover:bg-green-50 dark:hover:bg-green-900/20 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium text-sm"
                  >
                    {t.upload.uploadAnother || `${t.upload.uploadTitle} Another Video`}
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Upload Error State */}
        {uploadError && (
          <div className="mb-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 md:p-6">
            <div className="flex items-start">
              <AlertCircle className="h-6 w-6 text-red-500 mt-1 mr-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-base md:text-lg font-medium text-red-800 dark:text-red-200 mb-2">
                  {t.upload.uploadFailed}
                </h3>
                <p className="text-sm md:text-base text-red-700 dark:text-red-300 mb-4">
                  {uploadError}
                </p>
                <button
                  onClick={() => setUploadError(null)}
                  className="bg-red-600 text-white px-4 py-2 rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium text-sm"
                >
                  {t.common.retry || 'Try Again'}
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Single Upload Mode */}
        {uploadMode === 'single' && !uploadComplete && (
          <>
            {/* Upload Progress */}
            {uploadProgress > 0 && uploadProgress < 100 && !uploadError && (
              <div className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 md:p-6">
                <div className="flex items-start">
                  <Upload className="h-6 w-6 text-blue-500 mt-1 mr-3 flex-shrink-0" />
                  <div className="flex-1">
                    <h3 className="text-base md:text-lg font-medium text-blue-800 dark:text-blue-200 mb-2">
                      {t.upload.uploading}
                    </h3>
                    <p className="text-sm md:text-base text-blue-700 dark:text-blue-300 mb-4">
                      {t.upload.waitingMessage || 'Please wait while your video is being uploaded and processed.'}
                    </p>
                    <div className="w-full bg-blue-200 dark:bg-blue-800 rounded-full h-2">
                      <div
                        className="bg-blue-600 h-2 rounded-full transition-all duration-300"
                        style={{ width: `${uploadProgress}%` }}
                      ></div>
                    </div>
                    <p className="text-sm text-blue-600 dark:text-blue-400 mt-2">
                      {uploadProgress.toFixed(0)}{t.upload.percentComplete || '% complete'}
                    </p>
                  </div>
                </div>
              </div>
            )}

            {/* Upload Component */}
            <div className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-4 md:p-6">
              <VideoUpload
                onUploadComplete={handleUploadComplete}
                onProgress={handleUploadProgress}
                onError={handleUploadError}
                className="w-full"
              />
            </div>
          </>
        )}

        {/* Batch Upload Mode */}
        {uploadMode === 'batch' && !uploadComplete && (
          <>
            {/* File Selection Area */}
            {files.length === 0 && !isInitiating && (
              <div className="mb-6">
                <div
                  className="
                    border-2 border-dashed
                    border-gray-300 dark:border-gray-600
                    rounded-lg
                    p-8 md:p-12
                    text-center
                    cursor-pointer
                    hover:border-blue-500 dark:hover:border-blue-400
                    transition-colors
                    relative
                  "
                  onClick={() => fileInputRef.current?.click()}
                >
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="video/*"
                    multiple
                    onChange={handleBatchFileSelect}
                    className="hidden"
                  />
                  <FileStack size={48} className="mx-auto mb-4 text-gray-400 dark:text-gray-500" />
                  <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white mb-2">
                    {t.batch.dragDropMultiple}
                  </h3>
                  <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                    {t.batch.clickToBrowse}
                  </p>
                  <p className="text-xs text-gray-500 dark:text-gray-400">
                    {t.batch.fileLimit}
                  </p>
                </div>
              </div>
            )}

            {/* Batch Upload Queue */}
            {(files.length > 0 || isInitiating) && (
              <div className="mb-6">
                <BatchUploadQueue
                  files={files}
                  overallProgress={overallProgress}
                  isUploading={isUploading}
                  onPauseAll={pauseAll}
                  onResumeAll={resumeAll}
                  onCancelAll={cancelAll}
                  onRemoveFile={removeFile}
                  onPauseFile={pauseUpload}
                  onResumeFile={resumeUpload}
                  onCancelFile={cancelUpload}
                  onRetryFile={retryUpload}
                />
              </div>
            )}

            {/* Batch Upload Actions */}
            {files.length > 0 && !isUploading && (
              <div className="flex flex-col sm:flex-row gap-3 mb-6">
                <button
                  onClick={startUpload}
                  disabled={isInitiating || files.every(f => f.status === 'completed' || f.status === 'cancelled')}
                  className="
                    flex-1
                    bg-blue-600 text-white
                    px-4 py-3
                    rounded-md
                    hover:bg-blue-700
                    disabled:opacity-50 disabled:cursor-not-allowed
                    focus:outline-none focus:ring-2 focus:ring-blue-500
                    font-medium
                    text-sm md:text-base
                  "
                >
                  {t.batch.startUploads}
                </button>
                <button
                  onClick={() => fileInputRef.current?.click()}
                  className="
                    flex-1
                    bg-white dark:bg-gray-700
                    text-gray-700 dark:text-gray-300
                    border border-gray-300 dark:border-gray-600
                    px-4 py-3
                    rounded-md
                    hover:bg-gray-50 dark:hover:bg-gray-600
                    focus:outline-none focus:ring-2 focus:ring-gray-500
                    font-medium
                    text-sm md:text-base
                  "
                >
                  {t.batch.addVideos}
                </button>
              </div>
            )}
          </>
        )}

        {/* Upload Guidelines */}
        {!uploadComplete && (
          <div className="mt-8 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 md:p-6">
            <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white mb-4">
              {t.upload.guidelines || 'Upload Guidelines'}
            </h3>
            <ul className="space-y-2 text-xs md:text-sm text-gray-600 dark:text-gray-400">
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineIslamicValues || 'Ensure your content aligns with Islamic values and community guidelines'}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineFormats || `Supported formats: ${VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY}`}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineMaxSize || `Maximum file size: ${VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE_DISPLAY}`}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineProcessing || 'Processing may take several minutes after upload'}</span>
              </li>
              {uploadMode === 'batch' && (
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 mr-3 flex-shrink-0"></span>
                  <span>Batch uploads support 1-15 videos simultaneously for efficient content publishing</span>
                </li>
              )}
            </ul>
          </div>
        )}
      </div>
    </main>
  );
};

export default UploadPage;
