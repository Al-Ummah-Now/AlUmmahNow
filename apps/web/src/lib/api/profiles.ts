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
    // If it's already a Profile object
    if (result.id && result.email) {
      logApiSuccess(fnName, 'Response format: Direct Profile object');
      profile = result as Profile;
    }
    // If it's wrapped in a success/result structure
    else if (result.success && result.result && result.result.profile) {
      logApiSuccess(fnName, 'Response format: Wrapped in success/result structure');
      profile = result.result.profile as Profile;
    }
    // If it's wrapped differently
    else if (result.profile) {
      logApiSuccess(fnName, 'Response format: Wrapped in profile property');
      profile = result.profile as Profile;
    }
    else {
      logApiError(fnName, 'Response format not recognized', { responseKeys: Object.keys(result) });
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
}) {
  return createProfileAPI(data);
}

// Note: Functions that call client-side callbacks (like setProfile)
// have been moved to profiles-client.ts to avoid server/client conflicts