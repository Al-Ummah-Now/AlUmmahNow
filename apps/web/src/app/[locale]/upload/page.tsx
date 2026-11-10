'use client';

import { logger } from '@/lib/logger-client';
import React, { useState, useCallback, useRef, useMemo } from "react";
import { VideoObject } from "@/interfaces";
import VideoUpload from "@/components/videoUpload";
import { BatchUploadQueue } from "@/components/videoUpload/BatchUploadQueue";
import { useParams, useSearchParams } from "next/navigation";
import { AlertCircle, Upload, FileStack, ShieldAlert } from "lucide-react";
import { UploadModeTabs, UPLOAD_MODE_PANEL_ID, UPLOAD_MODE_TAB_ID, type UploadMode } from "@/components/videoUpload/UploadModeTabs";
import { VIDEO_UPLOAD_CONFIG } from "@/lib/constants/uploadConfig";
import { useLanguage } from "@/hooks/useLanguage";
import { useLeaveGuard } from "@/hooks/useLeaveGuard";
import { useBatchUpload } from "@/hooks/useBatchUpload";
import { useBatchCategories } from "@/hooks/useBatchCategories";
import { CategorySelector } from "@/components/videoUpload/CategorySelector";
import { waitsForSuggestion } from "@/lib/category-suggestion/batch";
import type { UploadQueueItem, VideoCategory } from "@al-ummah/shared-types";
import { MAX_BATCH_FILES, isFinishedRow } from "@/lib/upload/batch-selection";
import { UploadProcessingCard } from "@/components/videoUpload/UploadProcessingCard";
import { useProcessingStatus } from "@/hooks/useProcessingStatus";
import { batchNotice } from "@/lib/upload/processing-status";
import { clearUploadResult, useUploadResult } from "@/lib/notifications/upload-results";
import { useActiveChannel } from "@/contexts/ActiveChannelContext";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useMultiAccount } from "@/hooks/useMultiAccount";
import { useCreatorAccess } from "@/hooks/useCreatorAccess";
import { UploadsByInvitationNotice } from "@/components/VideosNotices";
import { login } from "@/lib/actions";
import Link from "next/link";
import { can } from "@al-ummah/shared-types";
import { useChannelPlaylists } from "@/hooks/useChannelPlaylists";
import { usePlaylistAdds } from "@/hooks/usePlaylistAdds";
import { useBatchPlaylists } from "@/hooks/useBatchPlaylists";
import { PlaylistPicker } from "@/components/videoUpload/PlaylistPicker";
import { PlaylistAddNotices } from "@/components/videoUpload/PlaylistAddNotices";
import { BatchRowPlaylists } from "@/components/videoUpload/BatchRowPlaylists";
import { newBatchId, orderKeyFor } from "@/lib/upload/playlist-adds";


const UploadPage: React.FC = () => {
  const { t, lang } = useLanguage();
  const params = useParams();
  const locale = params.locale as string;
  // Studio "Re-upload" on a video flagged needs_reupload: upload into that video
  const searchParams = useSearchParams();
  const resumeVideoId = searchParams?.get('resume') || undefined;
  const resumeTitle = searchParams?.get('title') || undefined;
  const { activeChannel } = useActiveChannel();
  const auth = useAuth();
  const creator = useCreatorAccess();
  const { user: sessionUser, loading: sessionLoading } = useMultiAccount();
  // Uploads go to the session's active channel (the one picked in the account
  // menu, possibly a channel the user manages); the channel context is the
  // fallback while the session loads.
  const uploadChannelId = sessionUser?.channel?.id || activeChannel?.channelId || '';
  // The role on that channel (owner, or a channel role). Only a role that
  // can't upload (a channel moderator) is blocked; the API checks again.
  const uploadRole = sessionUser?.channels?.find((c) => c.id === uploadChannelId)?.role
    ?? (sessionUser?.channel?.id === uploadChannelId ? sessionUser?.channel?.role : undefined);
  const roleCannotUpload = !!uploadRole && !can(uploadRole, 'video.upload');

  const [uploadMode, setUploadMode] = useState<UploadMode>('single');
  const [uploadComplete, setUploadComplete] = useState(false);
  const [uploadedVideo, setUploadedVideo] = useState<VideoObject | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);

  const fileInputRef = useRef<HTMLInputElement>(null);
  // Batch category: a default for every video, each row can have its own
  const [batchCategory, setBatchCategory] = useState<VideoCategory | undefined>(undefined);
  const batchSharedMetadata = useMemo(() => ({ category: batchCategory }), [batchCategory]);

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
    sharedMetadata: batchSharedMetadata,
    onUploadComplete: (videoId) => {
      logger.debug('Video uploaded:', videoId);
    },
    onError: (error) => {
      setUploadError(error);
    },
  });

  // Playlists: the channel's list (both modes), the adds this page asked for,
  // and the batch's choice (one for every video, each row can have its own)
  const channelPlaylists = useChannelPlaylists(uploadChannelId);
  const { queue: queuePlaylistAdds, notices: playlistNotices } = usePlaylistAdds(uploadChannelId);
  const batchPlaylists = useBatchPlaylists(files, isUploading, queuePlaylistAdds);
  const singlePlaylists = useMemo(() => ({
    list: channelPlaylists.playlists,
    loading: channelPlaylists.loading,
    failed: channelPlaylists.failed,
    create: channelPlaylists.create,
  }), [channelPlaylists.playlists, channelPlaylists.loading, channelPlaylists.failed, channelPlaylists.create]);
  const handleSingleVideoReady = useCallback((videoId: string, playlistIds: string[]) => {
    queuePlaylistAdds(videoId, playlistIds, orderKeyFor(newBatchId(), 0));
  }, [queuePlaylistAdds]);
  const renderRowPlaylists = (file: UploadQueueItem) => {
    if (!file.videoId || file.alreadyUploaded || file.status === 'cancelled') return null;
    return (
      <BatchRowPlaylists
        rowId={file.id}
        playlists={channelPlaylists.playlists}
        loading={channelPlaylists.loading}
        failed={channelPlaylists.failed}
        batch={batchPlaylists.batchPlaylists}
        override={batchPlaylists.overrides[file.id]}
        committed={batchPlaylists.committed[file.id]}
        onOverride={(ids) => batchPlaylists.setRowPlaylists(file.id, ids)}
        onCreate={channelPlaylists.create}
      />
    );
  };

  // Processing status of what this page uploaded: the single upload, and every
  // batch file whose bytes are uploaded
  const processingIds = useMemo(() => {
    const ids = files.flatMap((f) => (f.status === 'completed' && f.videoId ? [f.videoId] : []));
    if (uploadedVideo?.id) ids.push(uploadedVideo.id);
    return ids;
  }, [files, uploadedVideo?.id]);
  const { phases: processingPhases, forget: forgetProcessingPhase } = useProcessingStatus(processingIds, uploadChannelId, auth?.user?.id);
  // A result pushed with the uploader's notification (NotificationCenter) wins over the poll
  const singleResult = useUploadResult(uploadedVideo?.id);

  // Leaving while batch files still upload from this tab would pause them
  const notice = uploadMode === 'batch' ? batchNotice(files, processingPhases, isUploading) : null;
  const batchBytesInFlight = notice === 'keepOpen';
  // An in-app link would stop them: ask first (closing the tab is not intercepted)
  const leaveDialog = useLeaveGuard(batchBytesInFlight, t.confirmDialog.uploadLeaveBody);

  const { rows: categoryRows, pick: pickRowCategory } = useBatchCategories(files, batchCategory, uploadChannelId);
  const renderRowCategory = (file: UploadQueueItem) => {
    const row = file.videoId ? categoryRows[file.videoId] : undefined;
    if (!file.videoId || !row) return null;
    const videoId = file.videoId;
    const saveText = row.save === 'saving' ? t.batch.categorySaving : row.save === 'saved' ? t.batch.categorySaved : row.save === 'failed' ? t.batch.categorySaveFailed : null;
    return (
      <>
        <CategorySelector
          id={`batch-category-${file.id}`}
          testId="batch-file-category-select"
          compact
          label={t.batch.videoCategory}
          value={row.category}
          onChange={(category) => pickRowCategory(videoId, category)}
          suggestion={row.suggestion}
          aiSelected={row.aiApplied}
          suggesting={waitsForSuggestion(row) && !row.category}
          onConfirm={() => pickRowCategory(videoId, row.category)}
        />
        {saveText && (
          <p
            role="status"
            data-testid="batch-file-category-save"
            data-state={row.save}
            className={`mt-1 text-xs ${row.save === 'failed' ? 'text-[var(--fanous-color-error-text)]' : 'text-muted-foreground'}`}
          >
            {saveText}
          </p>
        )}
      </>
    );
  };

  const handleUploadComplete = (video: VideoObject) => {
    // A re-upload of a video this session already saw finish starts at "processing" again
    if (video.id) {
      clearUploadResult(video.id);
      forgetProcessingPhase(video.id);
    }
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

  // Uploading is by invitation: a signed-in user without a creator tier gets the message, not the uploader
  if (creator.status === 'ready' && !creator.access.canUpload) {
    return (
      <main className="flex flex-col p-4 md:p-6 lg:p-8 w-full min-h-screen bg-background">
        <UploadsByInvitationNotice page />
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
                className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[var(--fanous-color-divider)] dark:bg-[var(--fanous-color-surface-raised)] text-[var(--fanous-color-text-primary)] rounded-lg hover:bg-[var(--fanous-color-divider)] dark:hover:bg-[var(--fanous-color-outline)] transition-colors font-medium"
              >
                {t.upload.goHome}
              </Link>
            </div>
          </div>
        </div>
      </main>
    );
  }

  // The active channel is one the user manages with a role that can't upload
  if (roleCannotUpload) {
    return (
      <main className="flex flex-col p-4 md:p-6 lg:p-8 w-full min-h-screen">
        <div className="max-w-2xl mx-auto w-full">
          <div className="c p-8 md:p-12 text-center" data-testid="upload-role-forbidden" data-role={uploadRole}>
            <ShieldAlert size={64} className="mx-auto mb-6 text-[var(--fanous-color-primary)]" aria-hidden="true" />
            <h1 className="text-2xl font-bold text-[var(--fanous-color-text-primary)] mb-4">{t.channelRoles.cannotUpload}</h1>
            <p className="text-[var(--fanous-color-text-secondary)] dark:text-[var(--fanous-color-text-muted)] mb-8">{t.channelRoles.cannotUploadHint}</p>
            <Link
              href={`/${locale}`}
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-[var(--fanous-color-divider)] dark:bg-[var(--fanous-color-surface-raised)] text-[var(--fanous-color-text-primary)] rounded-lg hover:bg-[var(--fanous-color-divider)] dark:hover:bg-[var(--fanous-color-outline)] transition-colors font-medium"
            >
              {t.upload.goHome}
            </Link>
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

        {/* Playlist adds being retried, or that will not happen (never the raw error) */}
        <PlaylistAddNotices notices={playlistNotices} playlists={channelPlaylists.playlists} />

        {/* Upload complete: the video now processes on the server */}
        {uploadComplete && uploadedVideo && (
          <UploadProcessingCard
            videoId={uploadedVideo.id}
            title={uploadedVideo.title}
            phase={singleResult ?? processingPhases[uploadedVideo.id] ?? 'processing'}
            onUploadAnother={handleUploadAnother}
          />
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
                      {t.uploadStatus.uploadingKeepOpen}
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
                playlists={singlePlaylists}
                onVideoReady={handleSingleVideoReady}
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

            {/* Settings for the whole batch */}
            <section className="mb-6 rounded-lg border border-border bg-background p-4" aria-labelledby="batch-settings-title" data-testid="batch-settings">
              <h2 id="batch-settings-title" className="mb-3 text-sm font-semibold text-foreground">{t.batch.batchSettings}</h2>
              <div className="grid max-w-3xl gap-4 md:grid-cols-2">
                <div>
                <CategorySelector
                  id="batch-category-default"
                  testId="batch-category-default"
                  label={t.batch.categoryForAll}
                  hint={t.batch.categoryForAllHint}
                  value={batchCategory}
                  onChange={setBatchCategory}
                  disabled={isInitiating}
                />
                </div>
                <PlaylistPicker
                  id="batch-playlists-default"
                  testId="batch-playlists-default"
                  label={t.playlist.upload.batchLabel}
                  hint={t.playlist.upload.batchHint}
                  playlists={channelPlaylists.playlists}
                  loading={channelPlaylists.loading}
                  failed={channelPlaylists.failed}
                  selected={batchPlaylists.batchPlaylists}
                  onChange={batchPlaylists.setBatchPlaylists}
                  onCreate={channelPlaylists.create}
                  disabled={isInitiating}
                />
              </div>
            </section>

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
                  processingPhases={processingPhases}
                  notice={notice}
                  onPauseAll={pauseAll}
                  onResumeAll={resumeAll}
                  onCancelAll={cancelAll}
                  onRemoveFile={removeFile}
                  onPauseFile={pauseUpload}
                  onResumeFile={resumeUpload}
                  onCancelFile={cancelUpload}
                  onRetryFile={retryUpload}
                  renderCategory={renderRowCategory}
                  renderPlaylists={renderRowPlaylists}
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
      {leaveDialog}
    </main>
  );
};

export default UploadPage;
