import { Profile } from "@/interfaces";
import { User } from "@/interfaces";
import { getProfileCurrent, createProfileAPI, updateProfileAPI } from "./profiles";
import { getApiUrl } from "@/lib/runtime-config";

const baseUrl = getApiUrl();

/**
 * Client-side helper function for fetching the current user's profile
 * This runs on the client and can call setProfile (React state setter)
 * Uses server session automatically - no need to pass user data
 */
export const fetchProfile = async (user: User | null | undefined, setProfile: (profile: Profile) => void): Promise<boolean> => {
    console.log('[fetchProfile] ========== START (CLIENT) ==========');
    console.log('[fetchProfile] Timestamp:', new Date().toISOString());
    console.log('[fetchProfile] Input user:', {
        hasUser: !!user,
        userId: user?.id,
        userEmail: user?.email,
        userIdType: typeof user?.id
    });

    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        console.log('[fetchProfile] ❌ Invalid user input - early return');
        console.log('[fetchProfile] ========== END (INVALID) ==========');
        return false;
    }

    try {
        console.log('[fetchProfile] Step 1: Calling server action getProfileCurrent()...');
        // Call the server action (uses auth session automatically)
        const profile = await getProfileCurrent();

        console.log('[fetchProfile] Step 2: Server action returned:', {
            hasProfile: !!profile,
            profileId: profile?.id,
            profileEmail: profile?.email
        });

        if (profile) {
            console.log('[fetchProfile] ✅ Success - API returned profile');
            console.log('[fetchProfile] Profile data:', {
                id: profile.id,
                email: profile.email,
                firstName: profile.firstName,
                lastName: profile.lastName,
                hasAvatar: !!profile.avatarUrl,
                hasCover: !!profile.coverUrl
            });
            console.log('[fetchProfile] Step 3: Setting profile in React state...');
            setProfile(profile);
            console.log('[fetchProfile] ========== END (SUCCESS) ==========');
            return true;
        } else {
            console.log('[fetchProfile] ⚠️ API returned null, creating default profile');
            const defaultProfile = {
                id: user.id,
                email: user.email,
                firstName: user.email?.split('@')[0] || 'User',
                lastName: '',
                avatarUrl: '/avatar.png',
                coverUrl: undefined
            };
            console.log('[fetchProfile] Default profile:', defaultProfile);
            console.log('[fetchProfile] Step 3: Setting default profile in React state...');
            setProfile(defaultProfile);
            console.log('[fetchProfile] ========== END (DEFAULT) ==========');
            return true;
        }
    } catch (error) {
        console.error('[fetchProfile] ❌ Exception caught:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        console.log('[fetchProfile] ========== END (EXCEPTION) ==========');
        return false;
    }
};

/**
 * Client-side helper function for checking if the current user's profile exists
 * Uses server session automatically
 * Returns true if profile exists, false if definitely doesn't exist, or true on error (fail-safe)
 */
export const checkProfileExists = async (user: User | null | undefined): Promise<boolean> => {
    console.log('[checkProfileExists] ========== START ==========');
    console.log('[checkProfileExists] User input:', {
        hasUser: !!user,
        userId: user?.id,
        userEmail: user?.email
    });

    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        console.log('[checkProfileExists] ❌ Invalid user input - returning false');
        console.log('[checkProfileExists] ========== END (INVALID) ==========');
        return false;
    }

    try {
        console.log('[checkProfileExists] Calling getProfileCurrent()...');
        // Call the server action (uses auth session automatically)
        const profile = await getProfileCurrent();

        console.log('[checkProfileExists] getProfileCurrent() returned:', {
            isNull: profile === null,
            hasProfile: !!profile,
            profileId: profile?.id,
            profileEmail: profile?.email,
            profileType: typeof profile
        });

        const exists = profile !== null;
        console.log('[checkProfileExists] Result: exists =', exists);
        console.log('[checkProfileExists] ========== END (SUCCESS) ==========');
        return exists;
    } catch (error) {
        console.error('[checkProfileExists] ❌ EXCEPTION during profile check:');
        console.error('[checkProfileExists] Error:', error);
        console.error('[checkProfileExists] Error message:', error instanceof Error ? error.message : 'Unknown');
        console.error('[checkProfileExists] Error stack:', error instanceof Error ? error.stack : 'N/A');
        // On error, assume profile exists to avoid false redirects
        // This is safer during session updates or network issues
        console.log('[checkProfileExists] Returning TRUE (fail-safe) due to error');
        console.log('[checkProfileExists] ========== END (ERROR) ==========');
        return true;
    }
};

/**
 * Client-side helper function for updating the current user's profile
 * Uses server session automatically for userId
 */
export const updateProfile = async (profile: Profile, setProfile: (profile: Profile) => void) => {
    console.log('[updateProfile] ========== START (CLIENT) ==========');
    console.log('[updateProfile] Timestamp:', new Date().toISOString());
    console.log('[updateProfile] Input profile:', {
        id: profile?.id,
        email: profile?.email,
        firstName: profile?.firstName,
        lastName: profile?.lastName
    });

    if (!profile) {
        console.log('[updateProfile] ❌ No profile provided - early return');
        console.log('[updateProfile] ========== END (INVALID) ==========');
        return;
    }

    try {
        const profileData = {
            firstName: profile.firstName,
            lastName: profile.lastName,
            avatarUrl: profile.avatarUrl,
            coverUrl: profile.coverUrl,
            email: profile.email,
        };

        console.log('[updateProfile] Step 1: Prepared profile data for API:', JSON.stringify(profileData, null, 2));

        // First, check if profile exists (uses auth session automatically)
        console.log('[updateProfile] Step 2: Checking if profile exists...');
        const existingProfile = await getProfileCurrent();

        console.log('[updateProfile] Step 3: Profile existence check result:', {
            exists: !!existingProfile,
            existingId: existingProfile?.id
        });

        // If profile doesn't exist (404), create it with POST
        if (!existingProfile) {
            console.log('[updateProfile] ⚠️ Profile not found, creating with POST');
            const createResult = await createProfileAPI(profileData);

            console.log('[updateProfile] Create result:', {
                hasResult: !!createResult,
                hasProfile: !!createResult?.result?.profile,
                profile: createResult?.result?.profile
            });

            if (createResult?.result?.profile) {
                console.log('[updateProfile] ✅ Profile created successfully');
                console.log('[updateProfile] Step 4: Setting created profile in React state...');
                setProfile(createResult.result.profile);
                console.log('[updateProfile] ========== END (CREATED) ==========');
                return true;
            }
        } else {
            // Profile exists, update it with PUT
            console.log('[updateProfile] ✅ Profile exists, updating with PUT');
            const updateResult = await updateProfileAPI(profileData);

            console.log('[updateProfile] Update result:', {
                hasResult: !!updateResult,
                hasProfile: !!updateResult?.result?.profile,
                profile: updateResult?.result?.profile
            });

            if (updateResult?.result?.profile) {
                console.log('[updateProfile] ✅ Profile updated successfully');
                console.log('[updateProfile] Step 4: Setting updated profile in React state...');
                setProfile(updateResult.result.profile);
                console.log('[updateProfile] ========== END (UPDATED) ==========');
                return true;
            }
        }

        // Fallback to old API with PUT
        console.log('[updateProfile] ⚠️ Falling back to old API');
        const fallbackUrl = `${baseUrl}/api/profiles/${profile.id}`;
        console.log('[updateProfile] Fallback URL:', fallbackUrl);
        console.log('[updateProfile] Fallback body:', JSON.stringify(profile, null, 2));

        const response = await fetch(fallbackUrl, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(profile),
        });

        console.log('[updateProfile] Fallback response:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
        });

        if (!response.ok) {
            throw new Error(`Error updating profile: ${response.statusText}`);
        }

        const updatedProfile: Profile = await response.json();
        console.log('[updateProfile] ✅ Fallback successful, profile:', updatedProfile);
        console.log('[updateProfile] Step 5: Setting profile in React state...');
        setProfile(updatedProfile);
        console.log('[updateProfile] ========== END (FALLBACK) ==========');
        return true;
    } catch (error) {
        console.error('[updateProfile] ❌ Exception caught:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        console.log('[updateProfile] ========== END (EXCEPTION) ==========');
        return false;
    }
};

/**
 * Client-side helper function for updating profile photo
 */
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
};

/**
 * Client-side helper function for updating cover photo
 */
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
};
