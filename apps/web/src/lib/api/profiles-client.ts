import { Profile } from "@/interfaces";
import { User } from "@/interfaces";
import { getProfileCurrent, getProfileById, createProfileAPI, updateProfileAPI } from "./profiles";
import { uploadFileDirect } from "./direct-upload";
import { logger } from '@/lib/logger-client';



/**
 * Client-side helper function for fetching the current user's profile
 * This runs on the client and can call setProfile (React state setter)
 * Uses server session automatically - no need to pass user data
 */
export const fetchProfile = async (user: User | null | undefined, setProfile: (profile: Profile) => void): Promise<boolean> => {
    logger.debug('[fetchProfile] ========== START (CLIENT) ==========');
    logger.debug('[fetchProfile] Timestamp:', new Date().toISOString());
    logger.debug('[fetchProfile] Input user:', {
        hasUser: !!user,
        
        userEmail: user?.email,
        userIdType: typeof user?.id
    });

    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        logger.debug('[fetchProfile] ❌ Invalid user input - early return');
        logger.debug('[fetchProfile] ========== END (INVALID) ==========');
        return false;
    }

    try {
        logger.debug('[fetchProfile] Step 1: Calling server action getProfileById()...');
        logger.debug('[fetchProfile] Target userId:', user.id);
        // Call the server action to fetch the specific user's profile
        const profile = await getProfileById(user.id);

        logger.debug('[fetchProfile] Step 2: Server action returned:', {
            hasProfile: !!profile,
            profileId: profile?.id,
            profileEmail: profile?.email
        });

        if (profile) {
            logger.debug('[fetchProfile] ✅ Success - API returned profile');
            logger.debug('[fetchProfile] Profile data:', {
                id: profile.id,
                email: profile.email,
                firstName: profile.firstName,
                lastName: profile.lastName,
                hasAvatar: !!profile.avatarUrl,
                hasCover: !!profile.coverUrl
            });
            logger.debug('[fetchProfile] Step 3: Setting profile in React state...');
            setProfile(profile);
            logger.debug('[fetchProfile] ========== END (SUCCESS) ==========');
            return true;
        } else {
            logger.debug('[fetchProfile] ⚠️ API returned null, creating default profile');
            const defaultProfile = {
                id: user.id,
                email: user.email,
                firstName: user.email?.split('@')[0] || 'User',
                lastName: '',
                avatarUrl: '/avatar.png',
                coverUrl: undefined
            };
            logger.debug('[fetchProfile] Default profile:', defaultProfile);
            logger.debug('[fetchProfile] Step 3: Setting default profile in React state...');
            setProfile(defaultProfile);
            logger.debug('[fetchProfile] ========== END (DEFAULT) ==========');
            return true;
        }
    } catch (error) {
        logger.error('[fetchProfile] ❌ Exception caught:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        logger.debug('[fetchProfile] ========== END (EXCEPTION) ==========');
        return false;
    }
};

/**
 * Client-side helper function for checking if the current user's profile exists
 * Uses server session automatically
 * Returns true if profile exists, false if definitely doesn't exist, or true on error (fail-safe)
 */
export const checkProfileExists = async (user: User | null | undefined): Promise<boolean> => {
    logger.debug('[checkProfileExists] ========== START ==========');
    logger.debug('[checkProfileExists] User input:', {
        hasUser: !!user,
        
        userEmail: user?.email
    });

    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        logger.debug('[checkProfileExists] ❌ Invalid user input - returning false');
        logger.debug('[checkProfileExists] ========== END (INVALID) ==========');
        return false;
    }

    try {
        logger.debug('[checkProfileExists] Calling getProfileCurrent()...');
        // Call the server action (uses auth session automatically)
        const profile = await getProfileCurrent();

        logger.debug('[checkProfileExists] getProfileCurrent() returned:', {
            isNull: profile === null,
            hasProfile: !!profile,
            profileId: profile?.id,
            profileEmail: profile?.email,
            profileType: typeof profile
        });

        const exists = profile !== null;
        logger.debug('[checkProfileExists] Result: exists =', exists);
        logger.debug('[checkProfileExists] ========== END (SUCCESS) ==========');
        return exists;
    } catch (error) {
        logger.error('[checkProfileExists] ❌ EXCEPTION during profile check:');
        logger.error('[checkProfileExists] Error:', error);
        logger.error('[checkProfileExists] Error message:', error instanceof Error ? error.message : 'Unknown');
        logger.error('[checkProfileExists] Error stack:', error instanceof Error ? error.stack : 'N/A');
        // On error, assume profile exists to avoid false redirects
        // This is safer during session updates or network issues
        logger.debug('[checkProfileExists] Returning TRUE (fail-safe) due to error');
        logger.debug('[checkProfileExists] ========== END (ERROR) ==========');
        return true;
    }
};

/**
 * Client-side helper function for updating the current user's profile
 * Uses server session automatically for userId
 */
/**
 * api-videos returns { success, result: { profile } }; older callers used { data: { profile } }.
 */
function profileFrom(res: unknown): Profile | undefined {
    const r = res as { result?: { profile?: Profile }; data?: { profile?: Profile } } | null | undefined;
    return r?.result?.profile ?? r?.data?.profile;
}

export const updateProfile = async (profile: Profile, setProfile: (profile: Profile) => void) => {
    logger.debug('[updateProfile] ========== START (CLIENT) ==========');
    logger.debug('[updateProfile] Timestamp:', new Date().toISOString());
    logger.debug('[updateProfile] Input profile:', {
        id: profile?.id,
        email: profile?.email,
        firstName: profile?.firstName,
        lastName: profile?.lastName
    });

    if (!profile) {
        logger.debug('[updateProfile] ❌ No profile provided - early return');
        logger.debug('[updateProfile] ========== END (INVALID) ==========');
        return;
    }

    try {
        const profileData = {
            firstName: profile.firstName,
            firstNameLocalized: profile.firstNameLocalized,
            lastName: profile.lastName,
            lastNameLocalized: profile.lastNameLocalized,
            displayName: profile.displayName,
            displayNameLocalized: profile.displayNameLocalized,
            bio: profile.bio,
            bioLocalized: profile.bioLocalized,
            avatarUrl: profile.avatarUrl,
            coverUrl: profile.coverUrl,
            email: profile.email,
            timezone: profile.timezone,
        };

        logger.debug('[updateProfile] Step 1: Prepared profile data for API:', JSON.stringify(profileData, null, 2));

        // First, check if profile exists (uses auth session automatically)
        logger.debug('[updateProfile] Step 2: Checking if profile exists...');
        const existingProfile = await getProfileCurrent();

        logger.debug('[updateProfile] Step 3: Profile existence check result:', {
            exists: !!existingProfile,
            existingId: existingProfile?.id
        });

        // If profile doesn't exist (404), create it with POST
        if (!existingProfile) {
            logger.debug('[updateProfile] ⚠️ Profile not found, creating with POST');
            const createResult = await createProfileAPI(profileData);

            logger.debug('[updateProfile] Create result:', {
                hasResult: !!createResult,
                hasProfile: !!profileFrom(createResult),
                profile: profileFrom(createResult)
            });

            if (profileFrom(createResult)) {
                logger.debug('[updateProfile] ✅ Profile created successfully');
                logger.debug('[updateProfile] Step 4: Setting created profile in React state...');
                setProfile(profileFrom(createResult)!);
                logger.debug('[updateProfile] ========== END (CREATED) ==========');
                return true;
            }
        } else {
            // Profile exists, update it with PUT
            logger.debug('[updateProfile] ✅ Profile exists, updating with PUT');
            const updateResult = await updateProfileAPI(profileData);

            logger.debug('[updateProfile] Update result:', {
                hasResult: !!updateResult,
                hasProfile: !!profileFrom(updateResult),
                profile: profileFrom(updateResult)
            });

            if (profileFrom(updateResult)) {
                logger.debug('[updateProfile] ✅ Profile updated successfully');
                logger.debug('[updateProfile] Step 4: Setting updated profile in React state...');
                setProfile(profileFrom(updateResult)!);
                logger.debug('[updateProfile] ========== END (UPDATED) ==========');
                return true;
            }
        }

        // The API rejected the request (validation/auth); surface it to the form
        logger.error('[updateProfile] ❌ API did not return a profile');
        logger.debug('[updateProfile] ========== END (FAILED) ==========');
        return false;
    } catch (error) {
        logger.error('[updateProfile] ❌ Exception caught:', {
            error,
            message: error instanceof Error ? error.message : 'Unknown error',
            stack: error instanceof Error ? error.stack : undefined
        });
        logger.debug('[updateProfile] ========== END (EXCEPTION) ==========');
        return false;
    }
};

/**
 * Client-side helper function for updating profile photo
 * Uploads directly to the API (see lib/api/direct-upload)
 */
export const updateProfilePhoto = async (profile: Profile, file: File, setProfile: (profile: Profile) => void) => {
    if (!profile || !file) return false;
    try {
        // Direct browser -> API upload; Server Actions with image bodies can be
        // blocked by Cloudflare's WAF rule for CVE-2025-55183 (403).
        const updatedProfile = await uploadFileDirect<Profile>('/api/profile/avatar', file);

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
 * Uploads directly to the API (see lib/api/direct-upload)
 */
export const updateCoverPhoto = async (profile: Profile, file: File, setProfile: (profile: Profile) => void) => {
    if (!profile || !file) return false;
    try {
        // Direct browser -> API upload; Server Actions with image bodies can be
        // blocked by Cloudflare's WAF rule for CVE-2025-55183 (403).
        const updatedProfile = await uploadFileDirect<Profile>('/api/profile/cover', file);

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

/**
 * Removes the profile's avatar or cover (the API stores an empty URL, which
 * every page shows as "no photo"). Only that field is sent.
 */
export const removeProfileImage = async (kind: 'avatar' | 'cover', setProfile: (profile: Profile) => void) => {
    try {
        const result = await updateProfileAPI(kind === 'avatar' ? { avatarUrl: '' } : { coverUrl: '' });
        const updated = profileFrom(result);
        if (updated) {
            setProfile(updated);
            return true;
        }
        return false;
    } catch (error) {
        logger.error('[removeProfileImage] Error:', error);
        return false;
    }
};
