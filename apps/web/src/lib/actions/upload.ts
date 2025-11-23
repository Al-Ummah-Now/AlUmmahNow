"use server";

import {
  initiateVideoUploadApi,
  completeVideoUploadApi,
  getVideoUploadStatusApi,
  initiateBatchUploadApi
} from "@/lib/api/videos";
import { getServerAuthContext } from "@/lib/api/server-auth-v2";

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
    category?: string;
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
    tusSessionId?: string; // Secure session ID for TUS proxy
    chunkSize: number;
    resumable: boolean;
    thumbnailUrl?: string;
    thumbnailSizes?: Record<string, string>;
    libraryId?: number;
    status?: string;
    message?: string;
    authToken?: string; // JWT token for TUS authentication
  };
  error?: string;
}> {
  const result = await initiateVideoUploadApi(metadata, { userId, channelId });

  // Add auth token to result for client-side TUS upload
  if (result?.success && result.result) {
    const authContext = await getServerAuthContext();
    if (authContext?.accessToken) {
      // Extend the result object with authToken
      return {
        ...result,
        result: {
          ...result.result,
          authToken: authContext.accessToken,
        }
      };
    }
  }

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
 * Initiate batch video upload - Server action for multiple videos
 */
export async function initiateBatchUpload(
  videos: Array<{
    title: string;
    description?: string;
    fileSize: number;
    mimeType: string;
    isPublic: boolean;
    tags?: string;
  }>,
  userId: string,
  channelId: string,
  sharedMetadata?: {
    channelId?: string;
    category?: string;
    isPublic?: boolean;
  }
): Promise<{
  success: boolean;
  result?: Array<{
    videoId: string;
    tusEndpoint: string;
    tusHeaders: {
      AuthorizationSignature: string;
      AuthorizationExpire: string;
      LibraryId: string;
      VideoId: string;
    };
    expiresAt: string;
  }>;
  error?: string;
}> {
  const result = await initiateBatchUploadApi(
    { videos, sharedMetadata },
    { userId, channelId }
  );
  return result || { success: false, error: "Failed to initiate batch upload" };
}

/**
 * SECURITY NOTE:
 * - Auth tokens are retrieved via getServerAuthContext() which uses SessionManager
 * - The getBunnyAccessKey() function has been removed
 * - API keys should NEVER be exposed to client-side code
 * - Video uploads are now handled server-side via the API backend
 */
