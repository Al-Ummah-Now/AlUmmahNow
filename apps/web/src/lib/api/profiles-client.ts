import { Profile } from "@/interfaces";
import { User } from "@/interfaces";
import { getProfileCurrent, getProfileById, createProfileAPI, updateProfileAPI, uploadProfileAvatar, uploadProfileCover } from "./profiles";
import { getApiUrl } from "@/lib/runtime-config";
import { logger } from '@/lib/logger-client';


const baseUrl = getApiUrl();

/**
 * Client-side helper function for fetching the current user's profile
 * This runs on the client and can call setProfile (React state setter)
 * Uses server session automatically - no need to pass user data
 */
export const fetchProfile = async (user: User | null | undefined, setProfile: (profile: Profile) => void): Promise<boolean> => {
    logger.info('[fetchProfile] ========== START (CLIENT) ==========');
    logger.info('[fetchProfile] Timestamp:', new Date().toISOString());
    logger.info('[fetchProfile] Input user:', {
        hasUser: !!user,
        userId: user?.id,
        userEmail: user?.email,
        userIdType: typeof user?.id
    });

    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        logger.info('[fetchProfile] ❌ Invalid user input - early return');
        logger.info('[fetchProfile] ========== END (INVALID) ==========');
        return false;
    }

    try {
        logger.info('[fetchProfile] Step 1: Calling server action getProfileById()...');
        logger.info('[fetchProfile] Target userId:', user.id);
        // Call the server action to fetch the specific user's profile
        const profile = await getProfileById(user.id);

        logger.info('[fetchProfile] Step 2: Server action returned:', {
            hasProfile: !!profile,
            profileId: profile?.id,
            profileEmail: profile?.email
        });

        if (profile) {
            logger.info('[fetchProfile] ✅ Success - API returned profile');
            logger.info('[fetchProfile] Profile data:', {
                id: profile.id,
                email: profile.email,
                firstName: profile.firstName,
                lastName: profile.lastName,
                hasAvatar: !!profile.avatarUrl,
                hasCover: !!profile.coverUrl
            });
            logger.info('[fetchProfile] Step 3: Setting profile in React state...');
            setProfile(profile);
            logger.info('[fetchProfile] ========== END (SUCCESS) ==========');
            return true;
        } else {
            logger.info('[fetchProfile] ⚠️ API returned null, creating default profile');
            const defaultProfile = {
                id: user.id,
                email: user.email,
                firstName: user.email?.split('@')[0] || 'User',
                lastName: '',
                avatarUrl: '/avatar.png',
                coverUrl: undefined
            };
            logger.info('[fetchProfile] Default profile:', defaultProfile);
            logger.info('[fetchProfile] Step 3: Setting default profile in React state...');
            setProfile(defaultProfile);
            logger.info('[fetchProfile] ========== END (DEFAULT) ==========');
            return true;
        }
    } catch (error) {
        logger.error('[fetchProfile] ❌ Exception caught:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        logger.info('[fetchProfile] ========== END (EXCEPTION) ==========');
        return false;
    }
};

/**
 * Client-side helper function for checking if the current user's profile exists
 * Uses server session automatically
 * Returns true if profile exists, false if definitely doesn't exist, or true on error (fail-safe)
 */
export const checkProfileExists = async (user: User | null | undefined): Promise<boolean> => {
    logger.info('[checkProfileExists] ========== START ==========');
    logger.info('[checkProfileExists] User input:', {
        hasUser: !!user,
        userId: user?.id,
        userEmail: user?.email
    });

    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        logger.info('[checkProfileExists] ❌ Invalid user input - returning false');
        logger.info('[checkProfileExists] ========== END (INVALID) ==========');
        return false;
    }

    try {
        logger.info('[checkProfileExists] Calling getProfileCurrent()...');
        // Call the server action (uses auth session automatically)
        const profile = await getProfileCurrent();

        logger.info('[checkProfileExists] getProfileCurrent() returned:', {
            isNull: profile === null,
            hasProfile: !!profile,
            profileId: profile?.id,
            profileEmail: profile?.email,
            profileType: typeof profile
        });

        const exists = profile !== null;
        logger.info('[checkProfileExists] Result: exists =', exists);
        logger.info('[checkProfileExists] ========== END (SUCCESS) ==========');
        return exists;
    } catch (error) {
        logger.error('[checkProfileExists] ❌ EXCEPTION during profile check:');
        logger.error('[checkProfileExists] Error:', error);
        logger.error('[checkProfileExists] Error message:', error instanceof Error ? error.message : 'Unknown');
        logger.error('[checkProfileExists] Error stack:', error instanceof Error ? error.stack : 'N/A');
        // On error, assume profile exists to avoid false redirects
        // This is safer during session updates or network issues
        logger.info('[checkProfileExists] Returning TRUE (fail-safe) due to error');
        logger.info('[checkProfileExists] ========== END (ERROR) ==========');
        return true;
    }
};

/**
 * Client-side helper function for updating the current user's profile
 * Uses server session automatically for userId
 */
export const updateProfile = async (profile: Profile, setProfile: (profile: Profile) => void) => {
    logger.info('[updateProfile] ========== START (CLIENT) ==========');
    logger.info('[updateProfile] Timestamp:', new Date().toISOString());
    logger.info('[updateProfile] Input profile:', {
        id: profile?.id,
        email: profile?.email,
        firstName: profile?.firstName,
        lastName: profile?.lastName
    });

    if (!profile) {
        logger.info('[updateProfile] ❌ No profile provided - early return');
        logger.info('[updateProfile] ========== END (INVALID) ==========');
        return;
    }

    try {
        const profileData = {
            firstName: profile.firstName,
            lastName: profile.lastName,
            displayName: profile.displayName,
            displayNameLocalized: profile.displayNameLocalized,
            bio: profile.bio,
            bioLocalized: profile.bioLocalized,
            avatarUrl: profile.avatarUrl,
            coverUrl: profile.coverUrl,
            email: profile.email,
            timezone: profile.timezone,
        };

        logger.info('[updateProfile] Step 1: Prepared profile data for API:', JSON.stringify(profileData, null, 2));

        // First, check if profile exists (uses auth session automatically)
        logger.info('[updateProfile] Step 2: Checking if profile exists...');
        const existingProfile = await getProfileCurrent();

        logger.info('[updateProfile] Step 3: Profile existence check result:', {
            exists: !!existingProfile,
            existingId: existingProfile?.id
        });

        // If profile doesn't exist (404), create it with POST
        if (!existingProfile) {
            logger.info('[updateProfile] ⚠️ Profile not found, creating with POST');
            const createResult = await createProfileAPI(profileData);

            logger.info('[updateProfile] Create result:', {
                hasResult: !!createResult,
                hasProfile: !!createResult?.result?.profile,
                profile: createResult?.result?.profile
            });

            if (createResult?.result?.profile) {
                logger.info('[updateProfile] ✅ Profile created successfully');
                logger.info('[updateProfile] Step 4: Setting created profile in React state...');
                setProfile(createResult.result.profile);
                logger.info('[updateProfile] ========== END (CREATED) ==========');
                return true;
            }
        } else {
            // Profile exists, update it with PUT
            logger.info('[updateProfile] ✅ Profile exists, updating with PUT');
            const updateResult = await updateProfileAPI(profileData);

            logger.info('[updateProfile] Update result:', {
                hasResult: !!updateResult,
                hasProfile: !!updateResult?.result?.profile,
                profile: updateResult?.result?.profile
            });

            if (updateResult?.result?.profile) {
                logger.info('[updateProfile] ✅ Profile updated successfully');
                logger.info('[updateProfile] Step 4: Setting updated profile in React state...');
                setProfile(updateResult.result.profile);
                logger.info('[updateProfile] ========== END (UPDATED) ==========');
                return true;
            }
        }

        // Fallback to old API with PUT
        logger.info('[updateProfile] ⚠️ Falling back to old API');
        const fallbackUrl = `${baseUrl}/api/profiles/${profile.id}`;
        logger.info('[updateProfile] Fallback URL:', fallbackUrl);
        logger.info('[updateProfile] Fallback body:', JSON.stringify(profile, null, 2));

        const response = await fetch(fallbackUrl, {
            method: "PUT",
            headers: {
                "Content-Type": "application/json",
            },
            body: JSON.stringify(profile),
        });

        logger.info('[updateProfile] Fallback response:', {
            status: response.status,
            statusText: response.statusText,
            ok: response.ok
        });

        if (!response.ok) {
            throw new Error(`Error updating profile: ${response.statusText}`);
        }

        const updatedProfile: Profile = await response.json();
        logger.info('[updateProfile] ✅ Fallback successful, profile:', updatedProfile);
        logger.info('[updateProfile] Step 5: Setting profile in React state...');
        setProfile(updatedProfile);
        logger.info('[updateProfile] ========== END (FALLBACK) ==========');
        return true;
    } catch (error) {
        logger.error('[updateProfile] ❌ Exception caught:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        logger.info('[updateProfile] ========== END (EXCEPTION) ==========');
        return false;
    }
};

/**
 * Client-side helper function for updating profile photo
 * Uses server action with proper authentication
 */
export const updateProfilePhoto = async (profile: Profile, file: File, setProfile: (profile: Profile) => void) => {
    if (!profile || !file) return false;
    try {
        const formData = new FormData();
        formData.append("photo", file);

        // Call server action which handles authentication
        const updatedProfile = await uploadProfileAvatar(formData);

        if (updatedProfile) {
            setProfile(updatedProfile);
            return true;
        }

        throw new Error('Failed to upload profile photo');
    } catch (error) {
        logger.error('[updateProfilePhoto] Error:', error);
        return false;
    }
};

/**
 * Client-side helper function for updating cover photo
 * Uses server action with proper authentication
 */
export const updateCoverPhoto = async (profile: Profile, file: File, setProfile: (profile: Profile) => void) => {
    if (!profile || !file) return false;
    try {
        const formData = new FormData();
        formData.append("photo", file);

        // Call server action which handles authentication
        const updatedProfile = await uploadProfileCover(formData);

        if (updatedProfile) {
            setProfile(updatedProfile);
            return true;
        }

        throw new Error('Failed to upload cover photo');
    } catch (error) {
        logger.error('[updateCoverPhoto] Error:', error);
        return false;
    }
};
