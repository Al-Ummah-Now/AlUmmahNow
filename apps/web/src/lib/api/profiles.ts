'use server';

import { cookies } from 'next/headers';
import { Profile } from "@/interfaces";
import { ApiResponse, ProfileUpdateRequest, ApiHeaders } from "./types";
import { getApiUrl } from "@/lib/runtime-config";
import { authenticated } from "@/lib/actions";

const baseUrl = getApiUrl();

/**
 * Get a user's profile by ID
 * GET /api/profiles/{id}
 * Server action that properly handles HttpOnly cookies
 */
export async function getProfileCurrent(
  userId: string,
  _headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<Profile | null> {
  try {
    const auth = await authenticated();

    if (!auth) {
      console.log('[getProfileCurrent] Not authenticated');
      return null;
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      console.log('[getProfileCurrent] No access token found');
      return null;
    }

    console.log('[getProfileCurrent] Making request to:', `${baseUrl}/api/profiles/${userId}`);

    const response = await fetch(`${baseUrl}/api/profiles/${userId}`, {
      method: 'GET',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken.value}`,
        'channelId': userId,
        'userId': userId,
      },
    });

    console.log('[getProfileCurrent] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[getProfileCurrent] Error response:', response.status, errorText);
      return null;
    }

    const result = await response.json();

    // Handle different response formats
    if (result && typeof result === 'object') {
      // If it's already a Profile object
      if (result.id && result.email) {
        return result as Profile;
      }
      // If it's wrapped in a success/result structure
      if (result.success && result.result && result.result.profile) {
        return result.result.profile as Profile;
      }
      // If it's wrapped differently
      if (result.profile) {
        return result.profile as Profile;
      }
    }

    console.log('[getProfileCurrent] Response format not recognized, returning null');
    return null;
  } catch (error) {
    console.error('[getProfileCurrent] error:', error);
    return null;
  }
}

/**
 * Create a new profile
 * POST /api/profiles
 * Server action that properly handles HttpOnly cookies
 */
export async function createProfileAPI(
  data: ProfileUpdateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ profile: Profile }> | null> {
  try {
    const auth = await authenticated();

    if (!auth) {
      throw new Error('Not authenticated');
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      throw new Error('Not authenticated - access_token cookie missing');
    }

    console.log('[createProfileAPI] Making request to:', `${baseUrl}/api/profiles`);
    console.log('[createProfileAPI] With data:', data);

    const response = await fetch(`${baseUrl}/api/profiles`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken.value}`,
        'channelId': headers.channelId,
        'userId': headers.userId,
      },
      body: JSON.stringify(data),
    });

    console.log('[createProfileAPI] Response status:', response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[createProfileAPI] Error response:', response.status, errorText);
      throw new Error(`Error creating profile: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('createProfileAPI error', error);
    return null;
  }
}

/**
 * Update the current user's profile
 * PUT /api/profiles/{id}
 * Server action that properly handles HttpOnly cookies
 */
export async function updateProfileAPI(
  data: ProfileUpdateRequest,
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<ApiResponse<{ profile: Profile }> | null> {
  try {
    const auth = await authenticated();

    if (!auth) {
      throw new Error('Not authenticated');
    }

    const cookieStore = await cookies();
    const accessToken = cookieStore.get('access_token');

    if (!accessToken?.value) {
      throw new Error('Not authenticated - access_token cookie missing');
    }

    const response = await fetch(`${baseUrl}/api/profiles/${headers.userId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken.value}`,
        'channelId': headers.channelId,
        'userId': headers.userId,
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('[updateProfileAPI] Error response:', response.status, errorText);
      throw new Error(`Error updating profile: ${response.statusText}`);
    }

    return await response.json();
  } catch (error) {
    console.error('updateProfileAPI error:', error);
    return null;
  }
}

/**
 * Delete the current user's profile
 * DELETE /api/profile
 * Server action that properly handles HttpOnly cookies
 */
export async function deleteProfileAPI(
  headers: Required<Pick<ApiHeaders, 'channelId' | 'userId'>>
): Promise<{ success: boolean } | null> {
  try {
    const auth = await authenticated();

    if (!auth) {
      throw new Error('Not authenticated');
    }

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
        'channelId': headers.channelId,
        'userId': headers.userId,
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

// Helper functions that use ProfilesAPI
import { User } from "@/interfaces";

/**
 * Server action for creating a profile - called from client components
 */
export async function createProfile(data: {
  id: string;
  firstName: string;
  lastName: string;
  avatarUrl?: string;
  coverUrl?: string;
  email: string;
}) {
  const auth = await authenticated();

  if (!auth) {
    throw new Error('Not authenticated');
  }

  return createProfileAPI(data, {
    userId: data.id,
    channelId: data.id
  });
}

export const fetchProfile = async (user: User | null | undefined, setProfile: (profile: Profile) => void): Promise<boolean> => {
    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        return false;
    }

    try {
        // Call the API with the user ID in the URL path and headers for auth
        const profile = await getProfileCurrent(user.id, {
            userId: user.id,
            channelId: user.id
        });

        if (profile) {
            console.log('fetchProfile: ✅ Success - API returned profile');
            setProfile(profile);
            return true;
        } else {
            console.log('fetchProfile: ⚠️ API returned null, creating default profile');
            // Create default profile if API returns null
            setProfile({
                id: user.id,
                email: user.email,
                firstName: user.email?.split('@')[0] || 'User',
                lastName: '',
                avatarUrl: '/avatar.png',
                coverUrl: undefined
            });
            return true;
        }
    } catch (error) {
        console.error('fetchProfile: ❌ Error:', error);
        return false;
    }
};

export const checkProfileExists = async (user: User | null | undefined): Promise<boolean> => {
    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        return false;
    }

    try {
        // Call the API with the user ID in the URL path and headers for auth
        // Note: In our application, user.id is used as channelId because each user has a default channel
        // associated with their account. This 1:1 relationship means user.id === channelId.
        const profile = await getProfileCurrent(user.id, {
            userId: user.id,
            channelId: user.id  // user.id serves as the default channel ID for the user
        });

        return profile !== null;
    } catch (error) {
        console.error('checkProfileExists: ❌ Error:', error);
        return false;
    }
};

// Note: isProfileComplete has been moved to profiles-utils.ts
// because 'use server' files can only export async functions

export const updateProfile = async (profile: Profile, setProfile: (profile: Profile) => void) => {
    if (!profile) return;
    try {
        const profileData = {
            firstName: profile.firstName,
            lastName: profile.lastName,
            avatarUrl: profile.avatarUrl,
            coverUrl: profile.coverUrl,
            email: profile.email,
        };

        const headers = {
            userId: profile.id,
            channelId: profile.id
        };

        // First, check if profile exists
        const existingProfile = await getProfileCurrent(profile.id, headers);

        // If profile doesn't exist (404), create it with POST
        if (!existingProfile) {
            console.log('Profile not found, creating with POST');
            const createResult = await createProfileAPI(profileData, headers);

            if (createResult?.result?.profile) {
                setProfile(createResult.result.profile);
                return true;
            }
        } else {
            // Profile exists, update it with PUT
            console.log('Profile exists, updating with PUT');
            const updateResult = await updateProfileAPI(profileData, headers);

            if (updateResult?.result?.profile) {
                setProfile(updateResult.result.profile);
                return true;
            }
        }

        // Fallback to old API with PUT
        const response = await fetch(
            `${baseUrl}/api/profiles/${profile.id}`,
            {
                method: "PUT",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(profile),
            }
        );
        if (!response.ok) {
            throw new Error(`Error updating profile: ${response.statusText}`);
        }
        const updatedProfile: Profile = await response.json();
        setProfile(updatedProfile);
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

export const updateProfilePhoto = async (profile: Profile, file: File, setProfile: (profile: Profile) => void) => {
    if (!profile || !file) return;
    try {
        const formData = new FormData();
        formData.append("photo", file);

        const response = await fetch(
            `${baseUrl}/api/profiles/${profile.id}/avatar`,
            {
                method: "PUT",
                body: formData,
            }
        );
        if (!response.ok) {
            throw new Error(`Error updating profile photo: ${response.statusText}`);
        }
        const updatedProfile: Profile = await response.json();
        setProfile(updatedProfile);
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

export const updateCoverPhoto = async (profile: Profile, file: File, setProfile: (profile: Profile) => void) => {
    if (!profile || !file) return;
    try {
        const formData = new FormData();
        formData.append("photo", file);

        const response = await fetch(
            `${baseUrl}/api/profiles/${profile.id}/cover`,
            {
                method: "PUT",
                body: formData,
            }
        );
        if (!response.ok) {
            throw new Error(`Error updating cover photo: ${response.statusText}`);
        }
        const updatedProfile: Profile = await response.json();
        setProfile(updatedProfile);
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}