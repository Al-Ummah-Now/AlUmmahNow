'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useCallback, useRef } from "react";
import { VideoObject } from "@/interfaces";
import VideoUpload from "@/components/videoUpload";
import { BatchUploadQueue } from "@/components/videoUpload/BatchUploadQueue";
import { useRouter, useParams, useSearchParams } from "next/navigation";
import { CheckCircle, AlertCircle, Upload, FileStack, ShieldAlert } from "lucide-react";
import { UploadModeTabs, UPLOAD_MODE_PANEL_ID, UPLOAD_MODE_TAB_ID, type UploadMode } from "@/components/videoUpload/UploadModeTabs";
import { VIDEO_UPLOAD_CONFIG } from "@/lib/constants/uploadConfig";
import { useLanguage } from "@/hooks/useLanguage";
import { useBatchUpload } from "@/hooks/useBatchUpload";
import { MAX_BATCH_FILES, isFinishedRow } from "@/lib/upload/batch-selection";
import { useActiveChannel } from "@/contexts/ActiveChannelContext";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { login } from "@/lib/actions";
import Link from "next/link";


const UploadPage: React.FC = () => {
  const { t, lang } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  const router = useRouter();
  // Studio "Re-upload" on a video flagged needs_reupload: upload into that video
  const searchParams = useSearchParams();
  const resumeVideoId = searchParams?.get('resume') || undefined;
  const resumeTitle = searchParams?.get('title') || undefined;
  const { activeChannel } = useActiveChannel();
  const auth = useAuth();
  const { user: sessionUser, loading: sessionLoading } = useMultiAccount();
  // The single uploader uploads to the session's active channel; fall back to
  // it while the channel context is still loading the user's channels.
  const uploadChannelId = activeChannel?.channelId || sessionUser?.channel?.id || '';

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
    clearFinished,
  } = useBatchUpload({
    channelId: uploadChannelId,
    onUploadComplete: (videoId) => {
      logger.debug('Video uploaded:', videoId);
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
    // Progress after a failure means the upload was retried/resumed
    if (percentage > 0) {
      setUploadError(null);
    }
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
    // Reset now, so picking the same files again (after an error, or to see
    // that they are already uploaded) still fires a change event
    e.target.value = '';
    if (selectedFiles.length === 0) return;
    // A new pick replaces the message of the previous one
    setUploadError(null);

    // Validate file count (one selection; the hook also keeps the unfinished
    // queue within the limit, finished rows never count)
    const MIN_FILES = 1;
    const MAX_FILES = MAX_BATCH_FILES;

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
    const allowedTypes = VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES as readonly string[];
    const invalidFiles = selectedFiles.filter(
      file => !allowedTypes.includes(file.type)
    );
    if (invalidFiles.length > 0) {
      setUploadError(
        t.batch.errors.invalidFileType.replace('{filename}', invalidFiles[0].name)
      );
      return;
    }

    // Add files to queue
    await addFiles(selectedFiles);
  }, [addFiles, t]);

  // Signed-out visitors get a sign-in prompt instead of the channel error
  if (!auth?.user) {
    return (
      <main className="flex flex-col p-4 md:p-6 lg:p-8 w-full min-h-screen bg-gray-50 dark:bg-gray-900">
        <div
          className="max-w-2xl mx-auto w-full bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 md:p-12 text-center"
          data-testid="upload-sign-in"
        >
          <h1 className="text-2xl font-semibold text-gray-900 dark:text-white mb-2">{t.navigation.signIn}</h1>
          <p className="text-gray-600 dark:text-gray-400 mb-6">{t.upload.authRequired}</p>
          <button
            type="button"
            onClick={() => { void login(locale); }}
            className="px-6 py-3 rounded-lg bg-blue-600 text-white hover:bg-blue-700 font-medium"
          >
            {t.navigation.signIn}
          </button>
        </div>
      </main>
    );
  }

  // Wait for the session's channels before deciding the user has none
  if (!uploadChannelId && sessionLoading) {
    return (
      <main className="flex flex-col p-4 md:p-6 lg:p-8 w-full min-h-screen bg-gray-50 dark:bg-gray-900">
        <div
          className="max-w-6xl mx-auto w-full h-64 rounded-lg bg-gray-200 dark:bg-gray-800 animate-pulse"
          role="status"
          aria-label={t.common.loading}
          data-testid="upload-loading"
        />
      </main>
    );
  }

  // Show 403 error if user has no channel
  if (!uploadChannelId) {
    return (
      <main className="flex flex-col p-4 md:p-6 lg:p-8 w-full min-h-screen bg-gray-50 dark:bg-gray-900">
        <div className="max-w-2xl mx-auto w-full">
          <div
            className="bg-white dark:bg-gray-800 rounded-lg shadow-lg p-8 md:p-12 text-center"
            data-testid="upload-channel-required"
          >
            <ShieldAlert size={64} className="mx-auto mb-6 text-red-500" />
            <h1 className="text-3xl font-bold text-gray-900 dark:text-white mb-4">
              {t.upload.channelRequiredTitle}
            </h1>
            <p className="text-lg text-gray-600 dark:text-gray-400 mb-8">
              {t.upload.channelRequiredMessage}
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link
                href={`/${locale}/profile/create`}
                data-testid="upload-create-channel"
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors font-medium"
              >
                {t.upload.createChannel}
              </Link>
              <Link
                href={`/${locale}`}
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-gray-200 dark:bg-gray-700 text-gray-900 dark:text-white rounded-lg hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors font-medium"
              >
                {t.upload.goHome}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

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

        {resumeVideoId && !uploadComplete && (
          <div
            className="mb-6 rounded-lg border border-primary/50 bg-primary/10 p-4 text-foreground"
            data-testid="upload-reupload-banner"
            data-video-id={resumeVideoId}
          >
            <p className="font-medium">{resumeTitle ? `${t.upload.reupload}: ${resumeTitle}` : t.upload.reupload}</p>
            <p className="text-sm mt-1 text-muted-foreground">{t.upload.reuploadBanner}</p>
          </div>
        )}

        {/* Upload mode tabs: the panel below belongs to the selected tab (a re-upload is one file into one video) */}
        {!uploadComplete && !resumeVideoId && (
          <UploadModeTabs
            mode={uploadMode}
            onChange={handleModeChange}
            labels={{
              group: t.upload.modeTabsLabel,
              single: t.upload.modeSingle,
              singleHint: t.upload.modeSingleHint,
              batch: t.upload.modeBatch,
              batchHint: t.upload.modeBatchHint,
            }}
          />
        )}

        {/* Upload Success State */}
        {uploadComplete && uploadedVideo && (
          <div
            className="mb-8 bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-800 rounded-lg p-4 md:p-6"
            data-testid="upload-success"
            data-video-id={uploadedVideo.id}
          >
            <div className="flex items-start">
              <CheckCircle className="h-6 w-6 text-green-500 mt-1 me-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-base md:text-lg font-medium text-green-800 dark:text-green-200 mb-2">
                  {t.upload.uploadComplete}!
                </h3>
                <p className="text-sm md:text-base font-medium text-green-900 dark:text-green-100 mb-1" data-testid="upload-success-title">
                  {uploadedVideo.title}
                </p>
                <p className="text-sm md:text-base text-green-700 dark:text-green-300 mb-4">
                  {t.upload.videoUploadedMessage || `Your video "${uploadedVideo.title}" has been uploaded and is now being processed.`}
                </p>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    data-testid="upload-view-video"
                    onClick={handleViewVideo}
                    className="bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium text-sm"
                  >
                    {t.upload.viewVideo || 'View Video'}
                  </button>
                  <button
                    type="button"
                    data-testid="upload-another"
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

        {!uploadComplete && (
        <div
          role="tabpanel"
          id={UPLOAD_MODE_PANEL_ID[uploadMode]}
          aria-labelledby={`${UPLOAD_MODE_TAB_ID[uploadMode]}-label`}
          className="upload-mode-panel"
          data-testid="upload-mode-panel"
        >
        {/* Upload Error State */}
        {uploadError && (
          <div
            className="mb-8 bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4 md:p-6"
            role="alert"
            data-testid="upload-page-error"
          >
            <div className="flex items-start">
              <AlertCircle className="h-6 w-6 text-red-500 mt-1 me-3 flex-shrink-0" />
              <div className="flex-1">
                <h3 className="text-base md:text-lg font-medium text-red-800 dark:text-red-200 mb-2">
                  {t.upload.uploadFailed}
                </h3>
                <p className="text-sm md:text-base text-red-700 dark:text-red-300 mb-4">
                  {uploadError}
                </p>
                <button
                  type="button"
                  data-testid="upload-page-error-dismiss"
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
        {uploadMode === 'single' && (
          <>
            {/* Upload Progress */}
            {uploadProgress > 0 && uploadProgress < 100 && !uploadError && (
              <div
                className="mb-8 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4 md:p-6"
                data-testid="upload-page-progress"
              >
                <div className="flex items-start">
                  <Upload className="h-6 w-6 text-blue-500 mt-1 me-3 flex-shrink-0" />
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
                resumeVideoId={resumeVideoId}
                resumeTitle={resumeTitle}
              />
            </div>
          </>
        )}

        {/* Batch Upload Mode */}
        {uploadMode === 'batch' && (
          <>
            {/* Kept mounted outside the drop area so "Add Videos" can open it once the queue has files */}
            <input
              ref={fileInputRef}
              type="file"
              accept="video/*"
              multiple
              onChange={handleBatchFileSelect}
              className="hidden"
              aria-label={t.upload.batchFileInput}
              data-testid="batch-file-input"
            />

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
                  data-testid="batch-dropzone"
                >
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
              <div className="mb-6" data-testid="batch-queue-container" data-initiating={isInitiating ? 'true' : 'false'}>
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
                  type="button"
                  data-testid="batch-start"
                  onClick={startUpload}
                  disabled={isInitiating || !files.some(f => f.status === 'pending')}
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
                  type="button"
                  data-testid="batch-add-videos"
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
                {files.some(isFinishedRow) && (
                  <button
                    type="button"
                    data-testid="batch-clear-finished"
                    onClick={clearFinished}
                    disabled={isInitiating}
                    className="flex-1 bg-background text-foreground border border-border px-4 py-3 rounded-md hover:bg-muted disabled:opacity-50 disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-ring font-medium text-sm md:text-base"
                  >
                    {t.batch.clearFinished}
                  </button>
                )}
              </div>
            )}
          </>
        )}

        </div>
        )}

        {/* Upload Guidelines */}
        {!uploadComplete && (
          <div className="mt-8 bg-gray-100 dark:bg-gray-800 rounded-lg p-4 md:p-6">
            <h3 className="text-base md:text-lg font-medium text-gray-900 dark:text-white mb-4">
              {t.upload.guidelines || 'Upload Guidelines'}
            </h3>
            <ul className="space-y-2 text-xs md:text-sm text-gray-600 dark:text-gray-400">
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 me-3 flex-shrink-0"></span>
                <span>
                  {t.upload.guidelineIslamicValues || 'Ensure your content aligns with Islamic values and community guidelines'}{' '}
                  <Link href={`/${lang}/community-guidelines`} className="text-blue-700 underline dark:text-blue-400" data-testid="upload-guidelines-link">
                    {t.communityGuidelines.navLabel}
                  </Link>
                </span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 me-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineFormats || `Supported formats: ${VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY}`}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 me-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineMaxSize || `Maximum file size: ${VIDEO_UPLOAD_CONFIG.MAX_FILE_SIZE_DISPLAY}`}</span>
              </li>
              <li className="flex items-start">
                <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 me-3 flex-shrink-0"></span>
                <span>{t.upload.guidelineProcessing || 'Processing may take several minutes after upload'}</span>
              </li>
              {uploadMode === 'batch' && (
                <li className="flex items-start">
                  <span className="inline-block w-2 h-2 bg-blue-500 rounded-full mt-2 me-3 flex-shrink-0"></span>
                  <span>{t.upload.batchGuideline}</span>
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
