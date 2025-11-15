'use server';

import { cookies } from 'next/headers';
import { Profile } from "@/interfaces";
import { ApiResponse, ProfileUpdateRequest } from "./types";
import { getApiUrl } from "@/lib/runtime-config";
import { authenticated } from "@/lib/actions";

const baseUrl = getApiUrl();

/**
 * Get the current authenticated user's profile
 * GET /api/profiles/{id}
 * Server action that properly handles HttpOnly cookies
 * Uses authenticated user ID automatically
 */
export async function getProfileCurrent(): Promise<Profile | null> {
  console.log('[getProfileCurrent] ========== START ==========');
  console.log('[getProfileCurrent] Timestamp:', new Date().toISOString());

  try {
    console.log('[getProfileCurrent] Step 1: Getting authenticated session...');
    const auth = await authenticated();

    if (!auth) {
      console.log('[getProfileCurrent] ❌ Not authenticated - no auth object');
      return null;
    }

    console.log('[getProfileCurrent] ✅ Authenticated session:', {
      hasAuth: !!auth,
      hasProperties: !!auth.properties,
      userId: auth.properties?.id,
      userIdType: typeof auth.properties?.id
    });

    const userId = auth.properties.id;

    console.log('[getProfileCurrent] Step 2: Getting cookies...');
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      console.log('[getProfileCurrent] ❌ No access token found in cookies');
      console.log('[getProfileCurrent] Available cookies:', cookieStore.getAll().map(c => c.name));
      return null;
    }

    console.log('[getProfileCurrent] ✅ Access token found:', {
      tokenLength: accessToken.value.length,
      tokenPreview: accessToken.value.substring(0, 20) + '...'
    });

    const requestUrl = `${baseUrl}/api/profiles/${userId}`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken.value}`,
      'userId': userId,
    };

    console.log('[getProfileCurrent] Step 3: Making API request...');
    console.log('[getProfileCurrent] Request URL:', requestUrl);
    console.log('[getProfileCurrent] Request Headers:', {
      'Content-Type': requestHeaders['Content-Type'],
      'Authorization': `Bearer ${requestHeaders.Authorization.substring(7, 27)}...`,
      'userId': requestHeaders.userId
    });

    const response = await fetch(requestUrl, {
      method: 'GET',
      headers: requestHeaders,
    });

    console.log('[getProfileCurrent] ✅ Response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[getProfileCurrent] ❌ API Error:', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      console.log('[getProfileCurrent] ========== END (ERROR) ==========');
      return null;
    }

    console.log('[getProfileCurrent] Step 4: Parsing response body...');
    const result = await response.json();
    console.log('[getProfileCurrent] Raw response body:', JSON.stringify(result, null, 2));

    // Handle different response formats
    let profile: Profile | null = null;

    if (result && typeof result === 'object') {
      // If it's already a Profile object
      if (result.id && result.email) {
        console.log('[getProfileCurrent] ✅ Response format: Direct Profile object');
        profile = result as Profile;
      }
      // If it's wrapped in a success/result structure
      else if (result.success && result.result && result.result.profile) {
        console.log('[getProfileCurrent] ✅ Response format: Wrapped in success/result structure');
        profile = result.result.profile as Profile;
      }
      // If it's wrapped differently
      else if (result.profile) {
        console.log('[getProfileCurrent] ✅ Response format: Wrapped in profile property');
        profile = result.profile as Profile;
      }
      else {
        console.log('[getProfileCurrent] ⚠️ Response format not recognized');
        console.log('[getProfileCurrent] Response keys:', Object.keys(result));
      }
    }

    if (profile) {
      console.log('[getProfileCurrent] ✅ Final profile:', {
        id: profile.id,
        email: profile.email,
        firstName: profile.firstName,
        lastName: profile.lastName,
        hasAvatar: !!profile.avatarUrl,
        hasCover: !!profile.coverUrl
      });
    }

    console.log('[getProfileCurrent] ========== END ==========');
    return profile;
  } catch (error) {
    console.error('[getProfileCurrent] ❌ Exception caught:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    console.log('[getProfileCurrent] ========== END (EXCEPTION) ==========');
    return null;
  }
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
  console.log('[createProfileAPI] ========== START ==========');
  console.log('[createProfileAPI] Timestamp:', new Date().toISOString());
  console.log('[createProfileAPI] Input data:', JSON.stringify(data, null, 2));

  try {
    console.log('[createProfileAPI] Step 1: Getting authenticated session...');
    const auth = await authenticated();

    if (!auth) {
      console.error('[createProfileAPI] ❌ Not authenticated - no auth object');
      throw new Error('Not authenticated');
    }

    console.log('[createProfileAPI] ✅ Authenticated session:', {
      hasAuth: !!auth,
      hasProperties: !!auth.properties,
      userId: auth.properties?.id,
      userIdType: typeof auth.properties?.id
    });

    const userId = auth.properties.id;

    console.log('[createProfileAPI] Step 2: Getting cookies...');
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      console.error('[createProfileAPI] ❌ No access token found in cookies');
      console.log('[createProfileAPI] Available cookies:', cookieStore.getAll().map(c => c.name));
      throw new Error('Not authenticated - access_token cookie missing');
    }

    console.log('[createProfileAPI] ✅ Access token found:', {
      tokenLength: accessToken.value.length,
      tokenPreview: accessToken.value.substring(0, 20) + '...'
    });

    const requestBody = { ...data, id: userId };
    const requestUrl = `${baseUrl}/api/profiles`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken.value}`,
      'userId': userId,
    };

    console.log('[createProfileAPI] Step 3: Making API request...');
    console.log('[createProfileAPI] Request URL:', requestUrl);
    console.log('[createProfileAPI] Request Method: POST');
    console.log('[createProfileAPI] Request Headers:', {
      'Content-Type': requestHeaders['Content-Type'],
      'Authorization': `Bearer ${requestHeaders.Authorization.substring(7, 27)}...`,
      'userId': requestHeaders.userId
    });
    console.log('[createProfileAPI] Request Body:', JSON.stringify(requestBody, null, 2));

    const response = await fetch(requestUrl, {
      method: 'POST',
      headers: requestHeaders,
      body: JSON.stringify(requestBody),
    });

    console.log('[createProfileAPI] ✅ Response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[createProfileAPI] ❌ API Error:', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      console.log('[createProfileAPI] ========== END (ERROR) ==========');
      throw new Error(`Error creating profile: ${response.statusText}`);
    }

    console.log('[createProfileAPI] Step 4: Parsing response body...');
    const result = await response.json();
    console.log('[createProfileAPI] Raw response body:', JSON.stringify(result, null, 2));
    console.log('[createProfileAPI] ========== END (SUCCESS) ==========');

    return result;
  } catch (error) {
    console.error('[createProfileAPI] ❌ Exception caught:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    console.log('[createProfileAPI] ========== END (EXCEPTION) ==========');
    return null;
  }
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
  console.log('[updateProfileAPI] ========== START ==========');
  console.log('[updateProfileAPI] Timestamp:', new Date().toISOString());
  console.log('[updateProfileAPI] Input data:', JSON.stringify(data, null, 2));

  try {
    console.log('[updateProfileAPI] Step 1: Getting authenticated session...');
    const auth = await authenticated();

    if (!auth) {
      console.error('[updateProfileAPI] ❌ Not authenticated - no auth object');
      throw new Error('Not authenticated');
    }

    console.log('[updateProfileAPI] ✅ Authenticated session:', {
      hasAuth: !!auth,
      hasProperties: !!auth.properties,
      userId: auth.properties?.id,
      userIdType: typeof auth.properties?.id
    });

    const userId = auth.properties.id;

    console.log('[updateProfileAPI] Step 2: Getting cookies...');
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      console.error('[updateProfileAPI] ❌ No access token found in cookies');
      console.log('[updateProfileAPI] Available cookies:', cookieStore.getAll().map(c => c.name));
      throw new Error('Not authenticated - access_token cookie missing');
    }

    console.log('[updateProfileAPI] ✅ Access token found:', {
      tokenLength: accessToken.value.length,
      tokenPreview: accessToken.value.substring(0, 20) + '...'
    });

    const requestUrl = `${baseUrl}/api/profiles/${userId}`;
    const requestHeaders = {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${accessToken.value}`,
      'userId': userId,
    };

    console.log('[updateProfileAPI] Step 3: Making API request...');
    console.log('[updateProfileAPI] Request URL:', requestUrl);
    console.log('[updateProfileAPI] Request Method: PUT');
    console.log('[updateProfileAPI] Request Headers:', {
      'Content-Type': requestHeaders['Content-Type'],
      'Authorization': `Bearer ${requestHeaders.Authorization.substring(7, 27)}...`,
      'userId': requestHeaders.userId
    });
    console.log('[updateProfileAPI] Request Body:', JSON.stringify(data, null, 2));

    const response = await fetch(requestUrl, {
      method: 'PUT',
      headers: requestHeaders,
      body: JSON.stringify(data),
    });

    console.log('[updateProfileAPI] ✅ Response received:', {
      status: response.status,
      statusText: response.statusText,
      ok: response.ok,
      headers: Object.fromEntries(response.headers.entries())
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[updateProfileAPI] ❌ API Error:', {
        status: response.status,
        statusText: response.statusText,
        errorBody: errorText
      });
      console.log('[updateProfileAPI] ========== END (ERROR) ==========');
      throw new Error(`Error updating profile: ${response.statusText}`);
    }

    console.log('[updateProfileAPI] Step 4: Parsing response body...');
    const result = await response.json();
    console.log('[updateProfileAPI] Raw response body:', JSON.stringify(result, null, 2));
    console.log('[updateProfileAPI] ========== END (SUCCESS) ==========');

    return result;
  } catch (error) {
    console.error('[updateProfileAPI] ❌ Exception caught:', {
      error,
      message: error instanceof Error ? error.message : 'Unknown error',
      stack: error instanceof Error ? error.stack : undefined
    });
    console.log('[updateProfileAPI] ========== END (EXCEPTION) ==========');
    return null;
  }
}

/**
 * Delete the current authenticated user's profile
 * DELETE /api/profile
 * Server action that properly handles HttpOnly cookies
 * Uses authenticated user ID automatically
 */
export async function deleteProfileAPI(): Promise<{ success: boolean } | null> {
  try {
    const auth = await authenticated();

    if (!auth) {
      throw new Error('Not authenticated');
    }

    const userId = auth.properties.id;
    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      throw new Error('Not authenticated - access_token cookie missing');
    }

    const response = await fetch(`${baseUrl}/api/profile`, {
      method: 'DELETE',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken.value}`,
        'userId': userId,
      },
    });

    if (!response.ok) {
      throw new Error(`Error deleting profile: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('deleteProfileAPI error:', error);
    return null;
  }
}

/**
 * Server action for creating a profile - called from client components
 * Simplified wrapper that uses automatic authentication
 */
export async function createProfile(data: {
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  coverUrl?: string;
  email: string;
}) {
  return createProfileAPI(data);
}

// Note: Functions that call client-side callbacks (like setProfile)
// have been moved to profiles-client.ts to avoid server/client conflicts