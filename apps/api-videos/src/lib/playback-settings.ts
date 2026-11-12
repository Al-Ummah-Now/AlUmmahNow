/**
 * The viewer's playback settings, kept on their profile record so they follow the account across
 * devices (docs/specs/PLAYLIST-PLAYBACK.md D8; the owner's "auto play like youtube", 2026-11-11).
 *
 * `autoplayNext`: when a video ends, the next one (the playlist's next item, else the first
 * "Up next" video) plays after the 3 s countdown. On unless the viewer turned it off.
 * The profile view (transformProfileToView) is an allowlist, so this never reaches public reads.
 */
import R2Repository from './r2Repo';

export interface PlaybackSettings {
	autoplayNext: boolean;
}

interface ProfileWithPlayback {
	id: string;
	playback?: Partial<PlaybackSettings>;
	dateModified?: string;
	[key: string]: unknown;
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = { autoplayNext: true };

export function playbackSettingsOf(profile: { playback?: Partial<PlaybackSettings> } | null | undefined): PlaybackSettings {
	return { autoplayNext: profile?.playback?.autoplayNext !== false };
}

export async function getPlaybackSettings(profiles: R2Bucket | undefined, userId: string): Promise<PlaybackSettings> {
	if (!profiles) return { ...DEFAULT_PLAYBACK_SETTINGS };
	return playbackSettingsOf(await new R2Repository<ProfileWithPlayback>(profiles).getObject(userId));
}

export async function setPlaybackSettings(
	profiles: R2Bucket,
	userId: string,
	email: string | undefined,
	patch: Partial<PlaybackSettings>,
): Promise<PlaybackSettings> {
	const now = new Date().toISOString();
	const updated = await new R2Repository<ProfileWithPlayback>(profiles).updateObject(
		userId,
		(profile) => {
			const next = { ...playbackSettingsOf(profile), ...patch };
			if (next.autoplayNext === playbackSettingsOf(profile).autoplayNext && profile.playback) return false;
			profile.playback = next;
			profile.dateModified = now;
			return true;
		},
		{
			initial: () => ({
				id: userId,
				email: email || 'unknown',
				dateCreated: now,
				dateModified: now,
				channels: [],
				subscribedTo: [],
			}),
		},
	);
	return playbackSettingsOf(updated);
}
