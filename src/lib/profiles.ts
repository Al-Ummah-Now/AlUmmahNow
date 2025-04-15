import { Profile, User } from "@/interfaces";


export const fetchProfile = async (user: User, setProfile: (profile: Profile) => void) => {
    if (!user) return;

    try {
        const response = await fetch(
            `https://videos.api.alummahnow.net/api/profile/${user.id}`
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
        setProfile(profile);
        return true;
    } catch (error) {
        console.error(error);
    }
};