/**
 * The viewer's playback settings, kept on their profile record so they follow the account across
 * devices (docs/specs/PLAYLIST-PLAYBACK.md D8; the owner's "auto play like youtube", 2026-11-11).
 *
 * `autoplayNext`: when a video ends, the next one (the playlist's next item, else the first
 * "Up next" video) plays after the 3 s countdown. Off unless the viewer turned it on
 * (wiki Epic 21, owner decision E21-D7, 2026-11-23).
 *
 * `autoplayNextSetByUser`: true once the viewer has saved a choice. Before E21-D7 the value was
 * only ever stored by an explicit save (PUT), so a stored boolean without the flag counts as an
 * explicit choice and is kept as it is; no bucket-wide migration is needed. A profile with no
 * stored value gets the new default, off.
 * The profile view (transformProfileToView) is an allowlist, so this never reaches public reads.
 */
import { accountEmailField } from './account-email';
import R2Repository from './r2Repo';

export interface PlaybackSettings {
	autoplayNext: boolean;
	autoplayNextSetByUser: boolean;
}

interface ProfileWithPlayback {
	id: string;
	playback?: Partial<PlaybackSettings>;
	dateModified?: string;
	[key: string]: unknown;
}

export const DEFAULT_PLAYBACK_SETTINGS: PlaybackSettings = { autoplayNext: false, autoplayNextSetByUser: false };

export function playbackSettingsOf(profile: { playback?: Partial<PlaybackSettings> } | null | undefined): PlaybackSettings {
	const stored = profile?.playback?.autoplayNext;
	if (typeof stored !== 'boolean') return { ...DEFAULT_PLAYBACK_SETTINGS };
	return { autoplayNext: stored, autoplayNextSetByUser: true };
}

export async function getPlaybackSettings(profiles: R2Bucket | undefined, userId: string): Promise<PlaybackSettings> {
	if (!profiles) return { ...DEFAULT_PLAYBACK_SETTINGS };
	return playbackSettingsOf(await new R2Repository<ProfileWithPlayback>(profiles).getObject(userId));
}

export async function setPlaybackSettings(
	profiles: R2Bucket,
	userId: string,
	email: string | undefined,
	patch: Pick<PlaybackSettings, 'autoplayNext'>,
): Promise<PlaybackSettings> {
	const now = new Date().toISOString();
	const updated = await new R2Repository<ProfileWithPlayback>(profiles).updateObject(
		userId,
		(profile) => {
			const next: PlaybackSettings = { autoplayNext: patch.autoplayNext, autoplayNextSetByUser: true };
			const stored = profile.playback;
			if (stored?.autoplayNext === next.autoplayNext && stored.autoplayNextSetByUser === true) return false;
			profile.playback = next;
			profile.dateModified = now;
			return true;
		},
		{
			initial: () => ({
				id: userId,
				...accountEmailField(email),
				dateCreated: now,
				dateModified: now,
				channels: [],
				subscribedTo: [],
			}),
		},
	);
	return playbackSettingsOf(updated);
}
