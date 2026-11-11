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
import { VIDEOS_ACCOUNT_PENDING_DELETION_CODE, VIDEOS_BANNED_CODE } from '@al-ummah/shared-types';

/**
 * Get the current authenticated user's profile
 * GET /api/profile
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

  logApiAuth(fnName, {
    userId: authContext.userId,
    hasToken: true,
    tokenLength: authContext.accessToken?.length
  });

  const result = await apiRequestServer<unknown>(
    {
      method: 'GET',
      url: buildApiUrl('/api/profile'),
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

  logger.debug(`[${fnName}] 🔐 Authentication:`);
  logger.debug(`[${fnName}]   Requesting User ID: ${authContext.userId}`);
  logger.debug(`[${fnName}]   Target User ID: ${userId}`);
  logger.debug(`[${fnName}]   Has Token: true`);
  logger.debug(`[${fnName}]   Token Length: ${authContext.accessToken?.length} chars`);

  const result = await apiRequestServer<unknown>(
    {
      method: 'GET',
      // Account details come only from the authenticated self route
      url: buildApiUrl(userId === authContext.userId ? '/api/profile' : `/api/profiles/${userId}`),
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

  logger.debug(`[${fnName}] Starting profile creation...`);

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logger.error(`[${fnName}] Not authenticated - no auth context`);
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  logger.debug(`[${fnName}] Auth context:`, {
    userId: authContext.userId,
    hasToken: !!authContext.accessToken,
    tokenLength: authContext.accessToken?.length
  });

  logApiAuth(fnName, {
    userId: authContext.userId,
    hasToken: true,
    tokenLength: authContext.accessToken?.length
  });

  const requestBody = { ...data, id: authContext.userId };
  logger.debug(`[${fnName}] Request body:`, { ...requestBody, email: '***' });

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
  } else {
    logger.error(`[${fnName}] Profile creation returned null`);
  }

  return result;
}

/**
 * Update the current authenticated user's profile
 * PUT /api/profile
 * Server action that properly handles HttpOnly cookies
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

  logApiAuth(fnName, {
    hasToken: true,
    tokenLength: authContext.accessToken?.length
  });

  const result = await apiRequestServer<ApiResponse<{ profile: Profile }>>(
    {
      method: 'PUT',
      url: buildApiUrl('/api/profile'),
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

  logApiAuth(fnName, {  hasToken: true });

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
  firstNameLocalized?: Record<string, string>;
  lastName: string;
  lastNameLocalized?: Record<string, string>;
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
 * PUT /api/profile/avatar
 * Server action that handles FormData upload with proper authentication
 */
export async function uploadProfileAvatar(formData: FormData): Promise<Profile | null> {
  const fnName = 'uploadProfileAvatar';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  logApiAuth(fnName, {  hasToken: true });

  // FormData is handled differently - we need to make the request directly
  // instead of using apiRequestServer which expects JSON
  const apiUrl = buildApiUrl('/api/profile/avatar');

  try {
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authContext.accessToken || ''}`,
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
 * PUT /api/profile/cover
 * Server action that handles FormData upload with proper authentication
 */
export async function uploadProfileCover(formData: FormData): Promise<Profile | null> {
  const fnName = 'uploadProfileCover';

  const authContext = await getServerAuthContext();
  if (!authContext) {
    logApiError(fnName, 'Not authenticated');
    return null;
  }

  logApiAuth(fnName, {  hasToken: true });

  // FormData is handled differently - we need to make the request directly
  const apiUrl = buildApiUrl('/api/profile/cover');

  try {
    const response = await fetch(apiUrl, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${authContext.accessToken || ''}`,
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
export interface VideosAccountStatus {
  /** Banned on the videos platform (admin decision; their Auth account is not affected) */
  banned: boolean;
  /** The ban's reason, when banned */
  reason: string | null;
  /** An admin deleted their videos data; restorable for 30 days, and nothing can be changed meanwhile (#701) */
  pendingDeletion: boolean;
}

const ACTIVE: VideosAccountStatus = { banned: false, reason: null, pendingDeletion: false };

/**
 * Whether the signed-in user may use the videos platform. api-videos answers
 * GET /api/profile with 403 `videos_banned` for a banned user and 403
 * `videos_account_pending_deletion` while an admin deletion of their videos
 * data is pending (a ban wins).
 */
export async function getVideosAccountStatus(): Promise<VideosAccountStatus> {
  const authContext = await getServerAuthContext();
  if (!authContext?.accessToken) return ACTIVE;
  try {
    const res = await fetch(buildApiUrl('/api/profile'), {
      headers: { Authorization: `Bearer ${authContext.accessToken}` },
      cache: 'no-store',
    });
    if (res.status !== 403) return ACTIVE;
    const body = (await res.json().catch(() => ({}))) as { code?: string; ban?: { reason?: string | null } };
    if (body.code === VIDEOS_BANNED_CODE) return { ...ACTIVE, banned: true, reason: body.ban?.reason ?? null };
    if (body.code === VIDEOS_ACCOUNT_PENDING_DELETION_CODE) return { ...ACTIVE, pendingDeletion: true };
    return ACTIVE;
  } catch (error) {
    logger.warn('[getVideosAccountStatus] Could not read the account state', { error: error instanceof Error ? error.message : String(error) });
    return ACTIVE;
  }
}
