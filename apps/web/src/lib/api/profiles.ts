'use server';

import { Profile } from "@/interfaces";
import { ApiResponse, ProfileUpdateRequest } from "./types";
import { apiRequestServer, buildApiUrl } from "./api-client";
import { getServerAuthContext } from "./server-auth";
import {
  logApiSuccess,
  logApiError,
  logApiAuth
} from "./logger";
import { logger } from '@/lib/logger-server';

/**
 * Get the current authenticated user's profile
 * GET /api/profiles/{id}
 * Server action that properly handles HttpOnly cookies
 * Uses authenticated user ID automatically
 */
export async function getProfileCurrent(): Promise<Profile | null> {
  const fnName = 'getProfileCurrent';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  const userId = authContext.userId!;
  logApiAuth(fnName, {
    userId,
    hasToken: true,
    tokenLength: authContext.accessToken?.length
  });

  const result = await apiRequestServer<unknown>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/profiles/${userId}`),
      functionName: fnName
    },
    getServerAuthContext,
    true // require auth
  );

  if (!result) {
    return null;
  }

  // Handle different response formats
  let profile: Profile | null = null;

  if (result && typeof result === 'object') {
    const response = result as Record<string, unknown>;

    // If it's already a Profile object
    if ('id' in response && 'email' in response) {
      logApiSuccess(fnName, 'Response format: Direct Profile object');
      profile = response as unknown as Profile;
    }
    // If it's wrapped in a success/result structure
    else if ('success' in response && 'result' in response) {
      const resultObj = response.result as Record<string, unknown>;
      if (resultObj && 'profile' in resultObj) {
        logApiSuccess(fnName, 'Response format: Wrapped in success/result structure');
        profile = resultObj.profile as Profile;
      }
    }
    // If it's wrapped differently
    else if ('profile' in response) {
      logApiSuccess(fnName, 'Response format: Wrapped in profile property');
      profile = response.profile as Profile;
    }
    else {
      logApiError(fnName, 'Response format not recognized', { responseKeys: Object.keys(response) });
    }
  }

  if (profile) {
    logApiSuccess(fnName, 'Profile retrieved successfully', {
      id: profile.id,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      hasAvatar: !!profile.avatarUrl,
      hasCover: !!profile.coverUrl
    });
  }

  return profile;
}

/**
 * Get a profile by userId
 * GET /api/profiles/{userId}
 * Server action that fetches any user's profile by their userId
 * Uses current user's authentication for the request
 */
export async function getProfileById(userId: string): Promise<Profile | null> {
  const fnName = 'getProfileById';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  logger.info(`[${fnName}] 🔐 Authentication:`);
  logger.info(`[${fnName}]   Requesting User ID: ${authContext.userId}`);
  logger.info(`[${fnName}]   Target User ID: ${userId}`);
  logger.info(`[${fnName}]   Has Token: true`);
  logger.info(`[${fnName}]   Token Length: ${authContext.accessToken?.length} chars`);

  const result = await apiRequestServer<unknown>(
    {
      method: 'GET',
      url: buildApiUrl(`/api/profiles/${userId}`),
      functionName: fnName
    },
    getServerAuthContext,
    true // require auth
  );

  if (!result) {
    return null;
  }

  // Handle different response formats
  let profile: Profile | null = null;

  if (result && typeof result === 'object') {
    const response = result as Record<string, unknown>;

    // If it's already a Profile object
    if ('id' in response && 'email' in response) {
      logApiSuccess(fnName, 'Response format: Direct Profile object');
      profile = response as unknown as Profile;
    }
    // If it's wrapped in a success/result structure
    else if ('success' in response && 'result' in response) {
      const resultObj = response.result as Record<string, unknown>;
      if (resultObj && 'profile' in resultObj) {
        logApiSuccess(fnName, 'Response format: Wrapped in success/result structure');
        profile = resultObj.profile as Profile;
      }
    }
    // If it's wrapped differently
    else if ('profile' in response) {
      logApiSuccess(fnName, 'Response format: Wrapped in profile property');
      profile = response.profile as Profile;
    }
    else {
      logApiError(fnName, 'Response format not recognized', { responseKeys: Object.keys(response) });
    }
  }

  if (profile) {
    logApiSuccess(fnName, 'Profile retrieved successfully', {
      id: profile.id,
      email: profile.email,
      firstName: profile.firstName,
      lastName: profile.lastName,
      hasAvatar: !!profile.avatarUrl,
      hasCover: !!profile.coverUrl
    });
  }

  return profile;
}

/**
 * Create a new profile for the current authenticated user
 * POST /api/profiles
 * Server action that properly handles HttpOnly cookies
 * Uses authenticated user ID automatically
 */
export async function createProfileAPI(
  data: ProfileUpdateRequest
): Promise<ApiResponse<{ profile: Profile }> | null> {
  const fnName = 'createProfileAPI';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  const userId = authContext.userId!;
  logApiAuth(fnName, {
    userId,
    hasToken: true,
    tokenLength: authContext.accessToken?.length
  });

  const requestBody = { ...data, id: userId };

  const result = await apiRequestServer<ApiResponse<{ profile: Profile }>>(
    {
      method: 'POST',
      url: buildApiUrl('/api/profiles'),
      body: requestBody,
      functionName: fnName
    },
    getServerAuthContext,
    true // require auth
  );

  if (result) {
    logApiSuccess(fnName, 'Profile created successfully', result);
  }

  return result;
}

/**
 * Update the current authenticated user's profile
 * PUT /api/profiles/{id}
 * Server action that properly handles HttpOnly cookies
 * Uses authenticated user ID automatically
 */
export async function updateProfileAPI(
  data: ProfileUpdateRequest
): Promise<ApiResponse<{ profile: Profile }> | null> {
  const fnName = 'updateProfileAPI';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  const userId = authContext.userId!;
  logApiAuth(fnName, {
    userId,
    hasToken: true,
    tokenLength: authContext.accessToken?.length
  });

  const result = await apiRequestServer<ApiResponse<{ profile: Profile }>>(
    {
      method: 'PUT',
      url: buildApiUrl(`/api/profiles/${userId}`),
      body: data,
      functionName: fnName
    },
    getServerAuthContext,
    true // require auth
  );

  if (result) {
    logApiSuccess(fnName, 'Profile updated successfully', result);
  }

  return result;
}

/**
 * Delete the current authenticated user's profile
 * DELETE /api/profile
 * Server action that properly handles HttpOnly cookies
 * Uses authenticated user ID automatically
 */
export async function deleteProfileAPI(): Promise<{ success: boolean } | null> {
  const fnName = 'deleteProfileAPI';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  const userId = authContext.userId!;
  logApiAuth(fnName, { userId, hasToken: true });

  const result = await apiRequestServer<{ success: boolean }>(
    {
      method: 'DELETE',
      url: buildApiUrl('/api/profile'),
      functionName: fnName
    },
    getServerAuthContext,
    true // require auth
  );

  if (result) {
    logApiSuccess(fnName, 'Profile deleted successfully');
  }

  return result;
}

/**
 * Server action for creating a profile - called from client components
 * Simplified wrapper that uses automatic authentication
 */
export async function createProfile(data: {
  firstName: string;
  lastName: string;
  displayName?: string;
  displayNameLocalized?: Record<string, string>;
  bio?: string;
  bioLocalized?: Record<string, string>;
  avatarUrl?: string;
  coverUrl?: string;
  email: string;
  timezone?: string;
}) {
  return createProfileAPI(data);
}

/**
 * Upload avatar photo for the current authenticated user
 * PUT /api/profiles/{id}/avatar
 * Server action that handles FormData upload with proper authentication
 */
export async function uploadProfileAvatar(formData: FormData): Promise<Profile | null> {
  const fnName = 'uploadProfileAvatar';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  const userId = authContext.userId!;
  logApiAuth(fnName, { userId, hasToken: true });

  // FormData is handled differently - we need to make the request directly
  // instead of using apiRequestServer which expects JSON
  const apiUrl = buildApiUrl(`/api/profiles/${userId}/avatar`);

  try {
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authContext.accessToken || ''}`,
        'userId': userId,
        'channelId': authContext.channelId || '',
      },
      body: formData,
    });

    if (!response.ok) {
      logApiError(fnName, `HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const result = await response.json();
    logApiSuccess(fnName, 'Avatar uploaded successfully');
    return result as Profile;
  } catch (error) {
    logApiError(fnName, 'Upload failed', error);
    return null;
  }
}

/**
 * Upload cover photo for the current authenticated user
 * PUT /api/profiles/{id}/cover
 * Server action that handles FormData upload with proper authentication
 */
export async function uploadProfileCover(formData: FormData): Promise<Profile | null> {
  const fnName = 'uploadProfileCover';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  const userId = authContext.userId!;
  logApiAuth(fnName, { userId, hasToken: true });

  // FormData is handled differently - we need to make the request directly
  const apiUrl = buildApiUrl(`/api/profiles/${userId}/cover`);

  try {
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authContext.accessToken || ''}`,
        'userId': userId,
        'channelId': authContext.channelId || '',
      },
      body: formData,
    });

    if (!response.ok) {
      logApiError(fnName, `HTTP ${response.status}: ${response.statusText}`);
      return null;
    }

    const result = await response.json();
    logApiSuccess(fnName, 'Cover uploaded successfully');
    return result as Profile;
  } catch (error) {
    logApiError(fnName, 'Upload failed', error);
    return null;
  }
}

// Note: Functions that call client-side callbacks (like setProfile)
// have been moved to profiles-client.ts to avoid server/client conflicts