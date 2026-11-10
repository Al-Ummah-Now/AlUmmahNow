'use client';
import { logger } from '@/lib/logger-client';
import { withoutErrorForwarding } from '@/lib/errors/reporter';
import { reportUploadError, uploadErrorMessage, type UploadStep } from '@/lib/upload/report-upload-error';
import React, { useState, useRef, useCallback, useEffect, useMemo } from "react";
import { ResilientUpload, grantedUploadUrl, reportUploadFailure, requestUploadResume, tusEndpointFor, type ReauthoriseResult } from "@/lib/upload/resilient-tus";
import { findRememberedUpload, forgetUpload, rememberUpload } from "@/lib/upload/resume-store";
import { tryFileFingerprint } from "@/lib/upload/fingerprint";
import { fetchClientAuthToken, getClientAuthHeaders } from "@/lib/auth/client-token";
import { VideoObject } from "@/interfaces";
import { useAuth } from "@/components/AuthProvider/authContext";
import { useMultiAccount } from '@/hooks/useMultiAccount';
import { VIDEO_UPLOAD_CONFIG, VIDEO_UPLOAD_ERRORS } from "@/lib/constants/uploadConfig";
import { Upload, X, AlertCircle, Pause, Play, RotateCcw } from "lucide-react";
import { initiateVideoUpload, completeVideoUpload, scheduleUploadedVideo } from "@/lib/api/upload-client";
import { creatorRefusalMessage } from "@/lib/upload/friendly-error";
import { refreshCreatorAccess } from "@/hooks/useCreatorAccess";
import { useHoldReloadWhile } from "@/lib/version-skew/VersionSkewProvider";
import { VideoFormatChoice, type VideoFormatChoiceValue } from "@/components/videoFormat/VideoFormatChoice";
import { useLanguage } from "@/hooks/useLanguage";
import { UploadButton } from "@/components/UploadButton";
import { ThumbnailUploadSection, ThumbnailData } from "./ThumbnailUploadSection";
import { CategorySelector } from "./CategorySelector";
import { TemplateSelector } from "./TemplateSelector";
import { ScheduleDateTimeSelector, ScheduleData } from "./ScheduleDateTimeSelector";
import { PlaylistPicker } from "./PlaylistPicker";
import type { PlaylistWithVideos } from "@/lib/api/playlists";
import type { NewPlaylistInput } from "@/lib/api/upload-playlists-client";
import { applySuggestion, formText, isKnownCategory, newDraftKey, pickCategory, type CategoryFormState } from "@/lib/category-suggestion/form";
import { useCategorySuggestion } from "@/hooks/useCategorySuggestion";
import type { ProcessedMetadata } from "@/lib/upload/template-variables";
import { getApiUrl } from "@/lib/runtime-config";

interface VideoUploadProps {
  onUploadComplete: (video: VideoObject) => void;
  onProgress: (percentage: number) => void;
  onError: (error: string) => void;
  className?: string;
  /**
   * Re-upload into this existing video (studio "Re-upload" on a video flagged
   * needs_reupload) instead of creating a new one. Never falls back to a new video.
   */
  resumeVideoId?: string;
  /** Title of that video, prefilled (its metadata is kept as it is). */
  resumeTitle?: string;
  /** The channel's playlists (the page loads them once for both upload modes); no picker without them */
  playlists?: {
    list: PlaylistWithVideos[];
    loading: boolean;
    failed: boolean;
    create: (input: NewPlaylistInput) => Promise<PlaylistWithVideos | null>;
  };
  /** The video record exists (initiate answered): the page queues its playlist adds */
  onVideoReady?: (videoId: string, playlistIds: string[]) => void;
}

interface VideoMetadata {
  title: string;
  titleEn: string;
  titleAr: string;
  description?: string;
  descriptionEn?: string;
  descriptionAr?: string;
  tags?: string[];
  isPublic: boolean;
  /** Upload as Short / as video; 'auto' detects it from length and shape */
  format: VideoFormatChoiceValue;
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
  reconnecting?: boolean; // retrying a transient failure; progress is kept
}

const VideoUpload: React.FC<VideoUploadProps> = ({
  onUploadComplete,
  onProgress,
  onError,
  className = "",
  resumeVideoId,
  resumeTitle,
  playlists,
  onVideoReady,
}) => {
  const { t, lang } = useLanguage();

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
    isPublic: true,
    format: 'auto',
  });
  const [showMetadataForm, setShowMetadataForm] = useState(false);
  const [activeTab, setActiveTab] = useState<'en' | 'ar'>('en');
  const [selectedThumbnail, setSelectedThumbnail] = useState<ThumbnailData | null>(null);
  const [scheduleData, setScheduleData] = useState<ScheduleData | null>(null);
  const [scheduleError, setScheduleError] = useState<string | null>(null);
  // Category: AI suggests (preselected when confident), the uploader confirms or changes it
  const [categoryState, setCategoryState] = useState<CategoryFormState>({ aiApplied: false, touched: false });
  const [categoryDraftKey, setCategoryDraftKey] = useState(() => newDraftKey('upload'));
  // Playlists the new video is added to as soon as its record exists
  const [selectedPlaylists, setSelectedPlaylists] = useState<string[]>([]);
  const [playlistsRequested, setPlaylistsRequested] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const tusUploadRef = useRef<ResilientUpload | null>(null);
  const uploadStartTimeRef = useRef<number>(0);
  const lastProgressTimeRef = useRef<number>(0);
  const lastBytesUploadedRef = useRef<number>(0);
  const videoIdRef = useRef<string>('');
  const libraryIdRef = useRef<number>(0);
  const thumbnailUrlRef = useRef<string>('');

  const auth = useAuth();
  const { user: multiAccountUser } = useMultiAccount();
  const activeChannel = multiAccountUser?.channel;

  const categoryText = useMemo(
    () => formText({ titleEn: metadata.titleEn, titleAr: metadata.titleAr, descriptionEn: metadata.descriptionEn, descriptionAr: metadata.descriptionAr, tags: metadata.tags }),
    [metadata.titleEn, metadata.titleAr, metadata.descriptionEn, metadata.descriptionAr, metadata.tags],
  );
  // Never blocks the upload: suggestions are only asked for while the form is being filled in
  const { suggestion: categorySuggestion, loading: categorySuggesting } = useCategorySuggestion({
    draftKey: categoryDraftKey,
    text: categoryText,
    enabled: showMetadataForm && !!selectedFile && !uploadProgress && !categoryState.touched,
    channelId: activeChannel?.id,
  });
  useEffect(() => {
    setCategoryState((prev) => applySuggestion(prev, categorySuggestion));
  }, [categorySuggestion]);

  // Ask for confirmation before leaving while a transfer or processing is in
  // progress (leaving would abandon the upload)
  const uploadInFlight = uploadProgress?.state === 'uploading' || uploadProgress?.state === 'processing';
  // A deploy while this runs must not reload the page under the upload
  useHoldReloadWhile(uploadInFlight);
  useEffect(() => {
    if (!uploadInFlight) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [uploadInFlight]);

  // File validation
  const validateFile = (file: File): string | null => {
    type VideoMimeType = 'video/mp4' | 'video/mov' | 'video/avi' | 'video/webm';
    if (!VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES.includes(file.type as VideoMimeType)) {
      return (t.upload.invalidType || VIDEO_UPLOAD_ERRORS.INVALID_TYPE)
        .replace('{types}', VIDEO_UPLOAD_CONFIG.ALLOWED_TYPES_DISPLAY);
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
    // A re-upload keeps its video's title; a new upload starts from the file name
    const defaultTitle = resumeTitle || file.name.replace(/\.[^/.]+$/, "");
    setMetadata(prev => ({
      ...prev,
      title: defaultTitle,
      titleEn: defaultTitle,
      titleAr: ''
    }));
    setShowMetadataForm(true);
  }, [onError, t, resumeTitle]);

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

  // Moves the form into the error state (keeping the last progress) and
  // notifies the page so it can show the failure banner.
  // Step of the running upload, reported with a failure
  const uploadStepRef = useRef<UploadStep>('initiate');

  /**
   * Every failure of this form: reported to the admin Errors page (step,
   * file size and type, HTTP status), shown as a friendly message with the
   * reference. Our own translated messages are kept; raw errors never shown.
   */
  const reportFailure = (error: unknown, step: UploadStep = uploadStepRef.current) => {
    const e = (error ?? {}) as { message?: string; status?: number; serverRef?: string; refusal?: boolean };
    // A creator-tier refusal (no tier, upload limit) is an expected answer, not
    // a failure: its friendly message as is, nothing for the Errors page
    if (e.refusal && e.message) {
      setUploadProgress(prev => ({ percentage: prev?.percentage || 0, state: 'error', error: e.message }));
      onError(e.message);
      return;
    }
    const ref = reportUploadError(step, error, {
      flow: 'single',
      ...(selectedFile ? { file: selectedFile } : {}),
      ...(typeof e.status === 'number' ? { status: e.status } : {}),
      ...(e.serverRef ? { serverRef: e.serverRef } : {}),
    });
    withoutErrorForwarding(() => logger.error(`[VideoUpload] ${step} failed`, { ref, error }));
    const own = new Set<string>([t.upload.sessionMissing, t.upload.authTokenMissing, t.upload.completeFailed, t.upload.processingFailed].filter(Boolean));
    const friendly = e.message && own.has(e.message) ? e.message : t.errors.uploadFailed;
    const message = uploadErrorMessage(friendly, ref, lang);
    setUploadProgress(prev => ({
      percentage: prev?.percentage || 0,
      state: 'error',
      error: message,
    }));
    onError(message);
  };

  const uploadVideo = async () => {
    if (!selectedFile) return;

    // Check authentication
    if (!auth.user) {
      onError(t.upload.authRequired || VIDEO_UPLOAD_ERRORS.AUTH_REQUIRED);
      return;
    }

    // Check active channel
    if (!activeChannel) {
      onError(t.errors.channelRequired);
      return;
    }

    // Extract channelId after auth check
    const channelId = activeChannel.id;

    try {
      // Step 1: Initiate upload and get TUS configuration
      setUploadProgress({ percentage: 5, state: 'uploading' });
      onProgress(5);

      const tagsString = metadata.tags?.join(',') || '';
      const endpoint = tusEndpointFor(getApiUrl());

      // The same file picked again after a reload or a crash resumes its
      // video (same Bunny upload, at its offset) instead of a new one.
      let videoId = '';
      let tusSessionId = '';
      let uploadUrl: string | undefined;
      let fallbackAuthorization: string | undefined;
      // A studio Re-upload targets its video; otherwise the same file picked
      // again resumes the video it was being uploaded into.
      const targetVideoId = resumeVideoId || findRememberedUpload(selectedFile, channelId)?.videoId;
      if (targetVideoId) {
        let resumed: ReauthoriseResult | null = null;
        let lastError: unknown = null;
        for (let attempt = 0; attempt < (resumeVideoId ? 3 : 1) && !resumed; attempt++) {
          if (attempt) await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
          try {
            resumed = await requestUploadResume(getApiUrl(), targetVideoId, await getClientAuthHeaders());
          } catch (error) {
            lastError = error;
            logger.warn('[VideoUpload] Resume check failed', { videoId: targetVideoId, attempt, error });
          }
        }
        if (resumed?.kind === 'grant') {
          videoId = targetVideoId;
          tusSessionId = resumed.tusSessionId;
          uploadUrl = grantedUploadUrl(endpoint, resumed, selectedFile);
          libraryIdRef.current = 0;
          thumbnailUrlRef.current = '';
          rememberUpload(selectedFile, channelId, videoId);
        } else if (resumeVideoId) {
          // The user asked for this video: say why, never create another one.
          if (resumed?.kind === 'completed') throw new Error(t.upload.reuploadAlreadyDone);
          throw new Error(resumed?.kind === 'gone' ? resumed.message : (lastError instanceof Error ? lastError.message : VIDEO_UPLOAD_ERRORS.UPLOAD_FAILED));
        } else {
          forgetUpload(selectedFile, channelId);
        }
      }

      if (!videoId) {
        uploadStepRef.current = 'initiate';
        // Same file again (another tab or browser, storage cleared): the server
        // reuses its unfinished video and hands back its upload at the offset
        const fingerprint = await tryFileFingerprint(selectedFile);
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
            // When scheduling is enabled, video must be private until scheduled publish date
            isPublic: scheduleData ? false : metadata.isPublic,
            tags: tagsString,
            category: categoryState.category,
            // The video adopts this form's suggestion and records whether the uploader kept it
            categorySuggestionKey: categoryDraftKey,
            format: metadata.format,
            fileSize: selectedFile.size,
            mimeType: selectedFile.type,
            thumbnail: selectedThumbnail ? {
              type: selectedThumbnail.type,
              data: selectedThumbnail.data,
              position: selectedThumbnail.position,
              filename: selectedThumbnail.filename,
              ...(selectedThumbnail.video ? { video: selectedThumbnail.video } : {}),
            } : undefined,
            ...(fingerprint ? { fingerprint } : {}),
          },
          channelId
        );

        if (!initiateResult.success || !initiateResult.result) {
          // A creator-tier refusal (no tier, upload limit) in the user's words; never the server's text
          const refusal = creatorRefusalMessage(t, initiateResult);
          if (refusal) {
            logger.warn('[VideoUpload] Upload refused', { code: initiateResult.code, retryAfter: initiateResult.retryAfter });
            if (initiateResult.code === 'uploads_by_invitation') void refreshCreatorAccess();
            throw Object.assign(new Error(refusal), { refusal: true });
          }
          throw Object.assign(new Error(initiateResult.error || VIDEO_UPLOAD_ERRORS.UPLOAD_FAILED), { status: initiateResult.status, serverRef: initiateResult.serverRef });
        }

        const { videoId: newVideoId, tusSessionId: newSessionId, libraryId, authToken, thumbnailUrl: returnedThumbnailUrl, tusUploadId } = initiateResult.result;
        videoId = newVideoId;
        tusSessionId = newSessionId || '';
        uploadUrl = tusUploadId ? `${endpoint}/${tusUploadId}` : undefined;
        if (initiateResult.result.reused) logger.info('[VideoUpload] Reusing the unfinished upload of this file', { videoId, resumable: !!tusUploadId });
        fallbackAuthorization = authToken ? `Bearer ${authToken}` : undefined;
        libraryIdRef.current = libraryId || 0;
        thumbnailUrlRef.current = returnedThumbnailUrl || '';

        if (!newSessionId) {
          throw new Error(t.upload.sessionMissing);
        }

        if (!authToken) {
          throw new Error(t.upload.authTokenMissing);
        }
        rememberUpload(selectedFile, channelId, videoId);
      }
      videoIdRef.current = videoId;
      // The record exists: queue its playlist adds now (never blocks or fails the upload)
      if (selectedPlaylists.length > 0 && !resumeVideoId) {
        onVideoReady?.(videoId, selectedPlaylists);
        setPlaylistsRequested(true);
      }

      // Step 2: Create TUS upload using secure proxy endpoint
      uploadStartTimeRef.current = Date.now();
      lastProgressTimeRef.current = Date.now();
      lastBytesUploadedRef.current = 0;

      // Transient failures (deploys, KV/Bunny hiccups, network) are retried at
      // the server's offset, with a fresh token on every request; a lost
      // session re-authorises the same video (see resilient-tus.ts).
      const upload = new ResilientUpload({
        file: selectedFile,
        endpoint,
        videoId,
        tusSessionId,
        uploadUrl,
        metadata: {
          filename: selectedFile.name,
          filetype: selectedFile.type,
        },
        getAuthorization: async (force) => {
          const token = await fetchClientAuthToken(force);
          return token ? `Bearer ${token}` : fallbackAuthorization ?? null;
        },
        reauthorise: async (vid) => requestUploadResume(getApiUrl(), vid, await getClientAuthHeaders()),
        reportFailure: async (vid, reason) => reportUploadFailure(getApiUrl(), vid, await getClientAuthHeaders(), reason),
        onReconnecting: (reconnecting) => {
          setUploadProgress(prev => prev && prev.state === 'uploading' ? { ...prev, reconnecting } : prev);
        },
        onError: (error) => {
          reportFailure(error, 'tus');
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
        // tus-js-client does not await onSuccess, so every failure in here
        // must be caught and reported or the form stays in "processing".
        onSuccess: () => {
          forgetUpload(selectedFile, channelId);
          finishUpload().catch((error: unknown) => {
            reportFailure(error);
          });
        },
      });

      const finishUpload = async () => {
          setUploadProgress({ percentage: 75, state: 'processing' });
          onProgress(75);

          // Step 3: Complete upload
          uploadStepRef.current = 'complete';
          const completeResult = await completeVideoUpload(
            videoId,
            channelId,
            selectedFile.size,
            undefined // Duration will be detected by Bunny.net
          );

          if (!completeResult.success) {
            const refusal = creatorRefusalMessage(t, completeResult);
            if (refusal) throw Object.assign(new Error(refusal), { refusal: true });
            throw Object.assign(new Error(completeResult.error || t.upload.completeFailed), { status: completeResult.status, serverRef: completeResult.serverRef });
          }

          // The bytes are uploaded. Processing continues on the server (its
          // check loop finishes the record and notifies the uploader), so the
          // page shows "Upload complete, processing" now instead of waiting here.
          logger.debug('[VideoUpload] Upload complete; processing continues on the server', { videoId });

          setUploadProgress({ percentage: 100, state: 'complete' });
          onProgress(100);

          // Track scheduling result for video object
          let schedulingInfo: {
            scheduledPublishDate?: string;
            scheduledPublishTimezone?: string;
            scheduledPublishStatus?: 'scheduled' | 'publishing' | 'published' | 'failed' | 'cancelled';
          } = {};

          // If scheduled, create schedule after upload
          if (scheduleData) {
            try {
              const scheduleResult = await scheduleUploadedVideo(
                videoId,
                scheduleData.scheduledPublishDate,
                scheduleData.timezone,
                scheduleData.notifyOnPublish,
                channelId
              );

              if (scheduleResult?.success && scheduleResult.result) {
                // Store scheduling info to include in video object
                schedulingInfo = {
                  scheduledPublishDate: scheduleResult.result.scheduledPublishDate,
                  scheduledPublishTimezone: scheduleResult.result.timezone,
                  scheduledPublishStatus: scheduleResult.result.status,
                };
                logger.debug('Video scheduled successfully:', schedulingInfo);
                setScheduleError(null);
              } else {
                const ref = reportUploadError('schedule', scheduleResult?.error || 'Scheduling failed', { flow: 'single', videoId, ...(selectedFile ? { file: selectedFile } : {}) });
                setScheduleError(t.upload.scheduleFailed.replace('{error}', uploadErrorMessage(t.errors.genericError, ref, lang)));
              }
            } catch (schedError) {
              const ref = reportUploadError('schedule', schedError, { flow: 'single', videoId, ...(selectedFile ? { file: selectedFile } : {}) });
              setScheduleError(t.upload.scheduleFailed.replace('{error}', uploadErrorMessage(t.errors.genericError, ref, lang)));
            }
          }

          // Create video object for callback
          const videoData: VideoObject = {
            id: videoId,
            title: metadata.title,
            description: metadata.description || null,
            thumbnailUrl: thumbnailUrlRef.current,
            videoUrl: `${VIDEO_UPLOAD_CONFIG.BUNNY_CDN_BASE_URL}/library/${libraryIdRef.current}/videos/${videoId}`,
            userId: auth.user?.id || '',
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
            // When scheduled, video is private until scheduled publish date
            isPublic: scheduleData ? false : metadata.isPublic,
            isLive: false,
            // Include scheduling fields if video was scheduled
            ...(schedulingInfo.scheduledPublishDate && {
              scheduledPublishDate: schedulingInfo.scheduledPublishDate,
              scheduledPublishTimezone: schedulingInfo.scheduledPublishTimezone,
              scheduledPublishStatus: schedulingInfo.scheduledPublishStatus,
            }),
          };

          // Reset form
          resetForm();
          onUploadComplete(videoData);
      };

      tusUploadRef.current = upload;
      uploadStepRef.current = 'tus';
      await upload.start();

    } catch (error: unknown) {
      reportFailure(error);
    }
  };

  const pauseUpload = () => {
    if (tusUploadRef.current) {
      void tusUploadRef.current.abort();
      setUploadProgress(prev => prev ? { ...prev, state: 'paused', reconnecting: false } : null);
    }
  };

  const resumeUpload = () => {
    if (tusUploadRef.current) {
      void tusUploadRef.current.start();
      setUploadProgress(prev => prev ? { ...prev, state: 'uploading' } : null);
    }
  };

  const cancelUpload = () => {
    if (tusUploadRef.current) {
      void tusUploadRef.current.abort(true); // Remove fingerprint
      tusUploadRef.current = null;
    }
    if (selectedFile && activeChannel) forgetUpload(selectedFile, activeChannel.id);
    resetForm();
  };

  const retryUpload = () => {
    // Resume the existing TUS upload (same video record) when the transfer or
    // the completion step failed; only start over when initiate itself failed.
    if (tusUploadRef.current) {
      setUploadProgress(prev => prev ? { ...prev, state: 'uploading', error: undefined } : null);
      void tusUploadRef.current.start();
      return;
    }
    setUploadProgress(null);
    uploadVideo();
  };

  const resetForm = () => {
    setSelectedFile(null);
    setShowMetadataForm(false);
    setUploadProgress(null);
    // Clear the page-level progress banner as well
    onProgress(0);
    tusUploadRef.current = null;
    videoIdRef.current = '';
    libraryIdRef.current = 0;
    setSelectedThumbnail(null);
    setScheduleData(null);
    setScheduleError(null);
    setCategoryState({ aiApplied: false, touched: false });
    setCategoryDraftKey(newDraftKey('upload'));
    setSelectedPlaylists([]);
    setPlaylistsRequested(false);
    setMetadata({
      title: '',
      titleEn: '',
      titleAr: '',
      description: '',
      descriptionEn: '',
      descriptionAr: '',
      tags: [],
      isPublic: true,
      format: 'auto',
    });
  };

  // Stable identity: TemplateSelector must not re-run its loader (and re-apply the
  // default template over the user's edits) on every render.
  const handleTemplateApply = useCallback((processedMetadata: ProcessedMetadata) => {
    setMetadata(prev => ({
      ...prev,
      titleEn: processedMetadata.titleLocalized?.en || processedMetadata.title || prev.titleEn,
      titleAr: processedMetadata.titleLocalized?.ar || prev.titleAr,
      title: processedMetadata.title || prev.title,
      descriptionEn: processedMetadata.descriptionLocalized?.en || processedMetadata.description || prev.descriptionEn,
      descriptionAr: processedMetadata.descriptionLocalized?.ar || prev.descriptionAr,
      description: processedMetadata.description || prev.description,
      tags: processedMetadata.tags || prev.tags,
      isPublic: processedMetadata.visibility === 'public' ? true : processedMetadata.visibility === 'private' ? false : prev.isPublic,
    }));
    // A template's category is the uploader's choice
    if (isKnownCategory(processedMetadata.category)) {
      const category = processedMetadata.category;
      setCategoryState(pickCategory(category));
    }
  }, []);

  if (showMetadataForm && selectedFile) {
    return (
      <div
        className={`bg-white dark:bg-gray-800 rounded-lg p-6 shadow-lg ${className}`}
        data-testid="upload-details"
      >
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            {t.upload.videoDetails}
          </h3>
          <button
            type="button"
            onClick={resetForm}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
            disabled={uploadProgress?.state === 'uploading'}
            aria-label={t.upload.closeForm}
            data-testid="upload-close"
          >
            <X size={20} />
          </button>
        </div>

        <div className="mb-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">{t.upload.selectFile}:</p>
          <p className="font-medium text-gray-900 dark:text-white" data-testid="upload-file-name">{selectedFile.name}</p>
          <p className="text-sm text-gray-500">
            {formatBytes(selectedFile.size)}
          </p>
        </div>

        {uploadProgress && (
          <div className="mb-6" data-testid="upload-progress" data-state={uploadProgress.state}>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-gray-700 dark:text-gray-300" data-testid="upload-progress-status">
                {uploadProgress.state === 'uploading' && (uploadProgress.reconnecting ? <span data-testid="upload-reconnecting" role="status">{t.upload.reconnecting}</span> : t.upload.uploading)}
                {uploadProgress.state === 'paused' && t.upload.paused}
                {uploadProgress.state === 'processing' && t.upload.processingVideo}
                {uploadProgress.state === 'complete' && t.upload.uploadComplete}
                {uploadProgress.state === 'error' && t.upload.uploadFailed}
              </span>
              <span className="text-sm text-gray-500" data-testid="upload-progress-percent">{uploadProgress.percentage.toFixed(0)}%</span>
            </div>

            <div
              className="w-full bg-gray-200 rounded-full h-2 mb-2"
              role="progressbar"
              aria-label={t.upload.uploadProgress}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(uploadProgress.percentage)}
            >
              <div
                className={`h-2 rounded-full transition-all duration-300 ${
                  uploadProgress.state === 'error'
                    ? 'bg-red-600'
                    : uploadProgress.state === 'complete'
                    ? 'bg-green-600'
                    : uploadProgress.state === 'paused'
                    ? 'bg-brand'
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
              <div className="flex items-center mt-2 text-red-600" role="alert" data-testid="upload-error">
                <AlertCircle size={16} className="me-1" />
                <span className="text-sm">{uploadProgress.error}</span>
              </div>
            )}

            {/* Schedule error - shown after upload completes but scheduling failed */}
            {scheduleError && uploadProgress.state === 'complete' && (
              <div className="flex items-start mt-3 p-3 bg-brand-soft dark:bg-brand-soft text-brand-ink dark:text-brand-ink rounded-lg">
                <AlertCircle size={16} className="me-2 mt-0.5 flex-shrink-0" />
                <span className="text-sm">{scheduleError}</span>
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
            {/* Language names are shown in their own script (autonyms) */}
            <div className="flex gap-2 mb-2" role="tablist" aria-label={t.video.videoTitle}>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'en'}
                lang="en"
                data-testid="upload-lang-tab-en"
                onClick={() => setActiveTab('en')}
                className="tab-item"
                disabled={uploadProgress?.state === 'uploading'}
              >
                English
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === 'ar'}
                lang="ar"
                data-testid="upload-lang-tab-ar"
                onClick={() => setActiveTab('ar')}
                className="tab-item"
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
                placeholder={t.upload.titlePlaceholderEn}
                aria-label={t.upload.titlePlaceholderEn}
                data-testid="upload-title-en"
                dir="ltr"
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
                placeholder={t.upload.titlePlaceholderAr}
                aria-label={t.upload.titlePlaceholderAr}
                data-testid="upload-title-ar"
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
                placeholder={t.upload.descriptionPlaceholderEn}
                aria-label={t.upload.descriptionPlaceholderEn}
                data-testid="upload-description-en"
                dir="ltr"
                disabled={uploadProgress?.state === 'uploading'}
              />
            )}
            {activeTab === 'ar' && (
              <textarea
                value={metadata.descriptionAr}
                onChange={(e) => setMetadata(prev => ({ ...prev, descriptionAr: e.target.value }))}
                rows={3}
                className="w-full px-3 py-2 border border-gray-300 dark:border-gray-600 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:text-white"
                placeholder={t.upload.descriptionPlaceholderAr}
                aria-label={t.upload.descriptionPlaceholderAr}
                data-testid="upload-description-ar"
                dir="rtl"
                disabled={uploadProgress?.state === 'uploading'}
              />
            )}
          </div>

          {/* Category Selector */}
          <CategorySelector
            value={categoryState.category}
            onChange={(category) => setCategoryState(pickCategory(category))}
            suggestion={categorySuggestion}
            aiSelected={categoryState.aiApplied}
            suggesting={categorySuggesting}
            disabled={uploadProgress?.state === 'uploading'}
          />

          {/* Playlists: picked or created here, added once the video record exists */}
          {playlists && !resumeVideoId && (
            <PlaylistPicker
              id="upload-playlists"
              testId="upload-playlists"
              label={t.playlist.upload.label}
              hint={t.playlist.upload.hint}
              playlists={playlists.list}
              loading={playlists.loading}
              failed={playlists.failed}
              selected={selectedPlaylists}
              onChange={setSelectedPlaylists}
              onCreate={playlists.create}
              disabled={uploadProgress?.state === 'uploading'}
              locked={playlistsRequested}
            />
          )}

          {/* Upload as Short / as video (wins over detection) */}
          <VideoFormatChoice
            value={metadata.format}
            onChange={(format) => setMetadata(prev => ({ ...prev, format }))}
            name="videoUploadFormat"
            testIdPrefix="video-upload-format"
            disabled={uploadProgress?.state === 'uploading'}
          />

          <div className="space-y-1">
            <div className="flex items-center">
              <input
                type="checkbox"
                id="isPublic"
                checked={scheduleData ? false : metadata.isPublic}
                onChange={(e) => setMetadata(prev => ({ ...prev, isPublic: e.target.checked }))}
                className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded disabled:opacity-50"
                disabled={uploadProgress?.state === 'uploading' || !!scheduleData}
                data-testid="upload-is-public"
              />
              <label htmlFor="isPublic" className={`ms-2 block text-sm ${scheduleData ? 'text-gray-400 dark:text-gray-500' : 'text-gray-700 dark:text-gray-300'}`}>
                {t.upload.makePublic}
              </label>
            </div>
            {scheduleData && (
              <p className="text-xs text-blue-600 dark:text-blue-400 ms-6">
                {t.upload.privateUntilScheduled}
              </p>
            )}
          </div>

          {/* Thumbnail Upload Section */}
          <ThumbnailUploadSection
            videoFile={selectedFile}
            onThumbnailSelect={setSelectedThumbnail}
            disabled={uploadProgress?.state === 'uploading'}
          />

          {/* Schedule Selector - Always available for scheduling future publish */}
          <ScheduleDateTimeSelector
            onScheduleChange={setScheduleData}
            disabled={uploadProgress?.state === 'uploading'}
          />
        </div>

        <div className="flex gap-3">
          {!uploadProgress || uploadProgress.state === 'idle' ? (
            <>
              <UploadButton
                onClick={uploadVideo}
                text={t.upload.uploadTitle}
                disabled={!metadata.titleEn.trim()}
                className="flex-1 justify-center"
                showIcon={false}
                testId="upload-submit"
              />
              <button
                type="button"
                onClick={resetForm}
                data-testid="upload-cancel-form"
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t.common.cancel}
              </button>
            </>
          ) : uploadProgress.state === 'uploading' ? (
            <>
              <button
                type="button"
                onClick={pauseUpload}
                data-testid="upload-pause"
                className="flex-1 bg-brand text-on-brand px-4 py-2 rounded-md hover:bg-brand-hover focus:outline-none focus:ring-2 focus:ring-brand font-medium flex items-center justify-center gap-2"
              >
                <Pause size={16} />
                {t.upload.pause}
              </button>
              <button
                type="button"
                onClick={cancelUpload}
                data-testid="upload-cancel"
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
              >
                {t.upload.cancel}
              </button>
            </>
          ) : uploadProgress.state === 'paused' ? (
            <>
              <button
                type="button"
                onClick={resumeUpload}
                data-testid="upload-resume"
                className="flex-1 bg-green-600 text-white px-4 py-2 rounded-md hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-green-500 font-medium flex items-center justify-center gap-2"
              >
                <Play size={16} />
                {t.upload.resume}
              </button>
              <button
                type="button"
                onClick={cancelUpload}
                data-testid="upload-cancel"
                className="px-4 py-2 bg-red-600 text-white rounded-md hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500 font-medium"
              >
                {t.upload.cancel}
              </button>
            </>
          ) : uploadProgress.state === 'error' ? (
            <>
              <button
                type="button"
                onClick={retryUpload}
                data-testid="upload-retry"
                className="flex-1 bg-blue-600 text-white px-4 py-2 rounded-md hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-500 font-medium flex items-center justify-center gap-2"
              >
                <RotateCcw size={16} />
                {t.upload.retry}
              </button>
              <button
                type="button"
                onClick={cancelUpload}
                data-testid="upload-cancel-form"
                className="px-4 py-2 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 rounded-md hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-gray-500"
              >
                {t.common.cancel}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={resetForm}
              data-testid="upload-close-form"
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
        data-testid="upload-dropzone"
        data-drag-over={isDragOver ? 'true' : 'false'}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept="video/*"
          onChange={handleFileInputChange}
          className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
          multiple={false}
          aria-label={t.upload.selectFile}
          data-testid="upload-file-input"
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
          {/* Size and duration are unlimited (TUS), so only the formats are listed;
              the old line read "Max No limit • Max No limit" in both languages */}
          <p className="text-sm text-gray-500 dark:text-gray-400" data-testid="upload-supported-formats">
            {t.upload.supports} MP4, MOV, AVI, WebM
          </p>
        </div>
      </div>
    </div>
  );
};

export default VideoUpload;
