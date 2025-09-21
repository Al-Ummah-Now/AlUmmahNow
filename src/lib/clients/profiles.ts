import { Profile, User } from "@/interfaces";

var baseUrl = process.env.API_URL || "https://videos.api.alummahnow.net";

export const fetchProfile = async (user: User, setProfile: (profile: Profile) => void) => {
    if (!user) return;

    try {
        const response = await fetch(
            `${baseUrl}/api/profiles/${user.id}`
        );
        if(response.status === 404) {
            setProfile({
                id: user.id,
                email: user.email,
            })
        }
        if (!response.ok) {
            //throw new Error(`Error fetching video: ${response.statusText}`);
        }
        const profile: Profile = await response.json();
        if (profile) {
            setProfile(profile);
        }
        return true;
    } catch (error) {
        console.error(error);
    }
};

export const updateProfile = async (profile: Profile, setProfile: (profile: Profile) => void) => {
    if (!profile) return;
    try {
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
    }
}