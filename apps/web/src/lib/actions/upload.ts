"use server";

import { initiateVideoUploadApi, completeVideoUploadApi, getVideoUploadStatusApi } from "@/lib/api/videos";

/**
 * Initiate video upload - Server action with TUS support
 */
export async function initiateVideoUpload(
  metadata: {
    title: string;
    titleLocalized?: Record<string, string>;
    description?: string;
    descriptionLocalized?: Record<string, string>;
    isPublic?: boolean;
    tags?: string;
    fileSize: number;
    mimeType: string;
    thumbnail?: {
      type: 'auto' | 'custom';
      data?: string;
      position?: number;
      filename?: string;
    };
  },
  userId: string,
  channelId: string
): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    tusEndpoint: string;
    tusHeaders: {
      AuthorizationSignature: string;
      AuthorizationExpire: string;
      LibraryId: string;
      VideoId: string;
    };
    expiresAt: string;
    chunkSize: number;
    resumable: boolean;
    thumbnailUrl?: string;
    thumbnailSizes?: Record<string, string>;
    uploadUrl?: string;
    libraryId?: number;
    status?: string;
    message?: string;
  };
  error?: string;
}> {
  const result = await initiateVideoUploadApi(metadata, { userId, channelId });
  return result || { success: false, error: "Failed to initiate upload" };
}

/**
 * Complete video upload - Server action
 */
export async function completeVideoUpload(
  videoId: string,
  userId: string,
  channelId: string,
  fileSize?: number,
  duration?: number
): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    status: string;
    message: string;
  };
  error?: string;
}> {
  const result = await completeVideoUploadApi(videoId, { userId, channelId }, fileSize, duration);
  return result || { success: false, error: "Failed to complete upload" };
}

/**
 * Get video upload status - Server action
 */
export async function getVideoUploadStatus(
  videoId: string,
  userId: string,
  channelId: string
): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    status: "uploading" | "processing" | "ready" | "failed" | "deleted";
    progress: number;
    message?: string;
    encodingStatus?: {
      isProcessing: boolean;
      encodingProgress: number;
      availableResolutions: string[];
    };
  };
  error?: string;
}> {
  const result = await getVideoUploadStatusApi(videoId, { userId, channelId });
  return result || { success: false, error: "Failed to get upload status" };
}

/**
 * SECURITY NOTE: The getBunnyAccessKey() function has been removed.
 * API keys should NEVER be exposed to client-side code.
 * Video uploads are now handled server-side via the API backend.
 */
