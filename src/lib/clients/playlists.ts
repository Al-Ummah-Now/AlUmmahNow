import { Playlist, User } from "@/interfaces";

var baseUrl = process.env.API_URL || "https://videos.api.alummahnow.net";

export const fetchPlaylist = async (user: User, setPlaylist: (playlist: Playlist) => void) => {
    if (!user) return;

    try {
        const response = await fetch(
            `${baseUrl}/api/playlists/${user.id}`
        );
        // if(response.status === 404) {
        //     setPlaylist({
        //         id: user.id,
        //         email: user.email,
        //     })
        // }
        if (!response.ok) {
            //throw new Error(`Error fetching video: ${response.statusText}`);
        }
        const playlist: Playlist = await response.json();
        if (playlist) {
            setPlaylist(playlist);
        }
        return true;
    } catch (error) {
        console.error(error);
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
    }
}

