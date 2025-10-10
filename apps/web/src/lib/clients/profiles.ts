import { Profile, User } from "@/interfaces";
import { ProfilesAPI } from "@/lib/api";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

export const fetchProfile = async (user: User | null | undefined, setProfile: (profile: Profile) => void): Promise<boolean> => {
    // Early return for any invalid input
    if (!user || !user.id || typeof user.id !== 'string' || user.id.trim() === '') {
        return false;
    }

    try {
        // Call the API with the user ID in the URL path and headers for auth
        const profile = await ProfilesAPI.getCurrent(user.id, {
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
        const profile = await ProfilesAPI.getCurrent(user.id, {
            userId: user.id,
            channelId: user.id
        });
        
        return profile !== null;
    } catch (error) {
        console.error('checkProfileExists: ❌ Error:', error);
        return false;
    }
};

export const isProfileComplete = (profile: Profile | null): boolean => {
    if (!profile) return false;
    
    // Check if essential profile fields are filled
    return !!(
        profile.firstName && 
        profile.firstName.trim() !== '' && 
        profile.firstName !== profile.email?.split('@')[0] // Not just the default email prefix
    );
};

export const updateProfile = async (profile: Profile, setProfile: (profile: Profile) => void) => {
    if (!profile) return;
    try {
        // Try new API first
        const result = await ProfilesAPI.update(
            {
                firstName: profile.firstName,
                lastName: profile.lastName,
                avatarUrl: profile.avatarUrl,
                coverUrl: profile.coverUrl,
            },
            {
                userId: profile.id,
                channelId: profile.id // Assuming profile.id can be used as channelId
            }
        );
        
        if (result?.result?.profile) {
            setProfile(result.result.profile);
            return true;
        }
        
        // Fallback to old API
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
            `https://videos.api.alummahnow.net/api/profiles/${profile.id}/avatar`,
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
            `https://videos.api.alummahnow.net/api/profiles/${profile.id}/cover`,
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