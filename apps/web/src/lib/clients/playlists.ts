import { Playlist, User, PaginationResponse } from "@/interfaces";

const baseUrl = process.env.NEXT_PUBLIC_API_URL || process.env.API_URL || "https://videos.api.alummahnow.net";

export const fetchPlaylist = async (user: User, setPlaylist: (playlist: Playlist) => void) => {
    if (!user) return;

    try {
        const response = await fetch(
            `${baseUrl}/api/playlists/${user.id}`
        );
        if(response.status === 404) {
            // Handle case where user has no playlists
            return true;
        }
        if (!response.ok) {
            throw new Error(`Error fetching playlist: ${response.statusText}`);
        }
        const data: PaginationResponse<Playlist> = await response.json();
        if (data.data && data.data.length > 0) {
            setPlaylist(data.data[0]); // Set the first playlist
        }
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
};

export const updatePlaylist = async (profile: Playlist, setPlaylist: (playlist: Playlist) => void) => {
    if (!profile) return;
    try {
        const response = await fetch(
            `${baseUrl}/api/playlists/${profile.id}`,
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
        const updatedProfile: Playlist = await response.json();
        setPlaylist(updatedProfile);
        return true;
    } catch (error) {
        console.error(error);
        return false;
    }
}

