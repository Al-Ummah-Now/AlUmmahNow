import { Profile, User } from "@/interfaces";

export interface AccountNavigationProps {
    user: User | null;
    isVisible: boolean;
    onClose: () => void;
}

export interface NavItem {
    label: string; 
    icon: string;
    href: string;
    onClick?: () => void;
}

export const fetchProfile = async (user: User, setProfile: (profile: Profile) => void) => {
    if (!user) return;

    try {
        const response = await fetch(
            `https://videos.api.alummahnow.net/api/profile/${user.id}`
        );
        if (!response.ok) {
            throw new Error(`Error fetching video: ${response.statusText}`);
        }
        const profile: Profile = await response.json();
        setProfile(profile);
    } catch (error) {
        console.error(error);
    }
};