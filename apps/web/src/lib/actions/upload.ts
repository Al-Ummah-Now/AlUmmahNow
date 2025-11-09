"use server";

import { cookies } from "next/headers";

const baseUrl = process.env.API_URL;

if (!baseUrl) {
  throw new Error("API base URL is not configured. Please set API_URL in your environment.");
}

/**
 * Get the access token from cookies (server-side only)
 */
async function getAccessToken(): Promise<string | null> {
  const cookieStore = await cookies();
  const accessToken = cookieStore.get("access_token");
  return accessToken?.value || null;
}

/**
 * Initiate video upload - Server action
 */
export async function initiateVideoUpload(metadata: {
  title: string;
  description?: string;
  isPublic?: boolean;
  tags?: string;
}): Promise<{
  success: boolean;
  result?: {
    videoId: string;
    uploadUrl: string;
    libraryId: number;
    status: string;
    message: string;
  };
  error?: string;
}> {
  const token = await getAccessToken();
  
  if (!token) {
    return { success: false, error: "Authentication required" };
  }

  try {
    const response = await fetch(`${baseUrl}/api/videos/upload/initiate`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify(metadata),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      return { success: false, error: errorData.error || "Failed to initiate upload" };
    }

    return await response.json();
  } catch (error) {
    console.error("initiateVideoUpload error:", error);
    return { success: false, error: "Network error" };
  }
}

/**
 * Complete video upload - Server action
 */
export async function completeVideoUpload(
  videoId: string,
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
  const token = await getAccessToken();
  
  if (!token) {
    return { success: false, error: "Authentication required" };
  }

  try {
    const response = await fetch(`${baseUrl}/api/videos/upload/complete`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
      },
      body: JSON.stringify({ videoId, fileSize, duration }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      return { success: false, error: errorData.error || "Failed to complete upload" };
    }

    return await response.json();
  } catch (error) {
    console.error("completeVideoUpload error:", error);
    return { success: false, error: "Network error" };
  }
}

/**
 * Get video upload status - Server action
 */
export async function getVideoUploadStatus(videoId: string): Promise<{
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
  const token = await getAccessToken();
  
  if (!token) {
    return { success: false, error: "Authentication required" };
  }

  try {
    const response = await fetch(`${baseUrl}/api/videos/${videoId}/upload-status`, {
      method: "GET",
      headers: {
        "Authorization": `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({ error: "Unknown error" }));
      return { success: false, error: errorData.error || "Failed to get upload status" };
    }

    return await response.json();
  } catch (error) {
    console.error("getVideoUploadStatus error:", error);
    return { success: false, error: "Network error" };
  }
}

/**
 * Get Bunny.net access key for direct uploads (server-side only)
 * This allows the client to upload directly to Bunny.net with proper authentication
 */
export async function getBunnyAccessKey(): Promise<{ success: boolean; accessKey?: string; error?: string }> {
  try {
    // Get the Bunny Stream key from environment (server-side only)
    const accessKey = process.env.BUNNY_STREAM_KEY;
    
    if (!accessKey) {
      return { success: false, error: "Bunny Stream key not configured" };
    }

    return { success: true, accessKey };
  } catch (error) {
    console.error("getBunnyAccessKey error:", error);
    return { success: false, error: "Failed to get access key" };
  }
}
