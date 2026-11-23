/**
 * The signed-in viewer's intentional-viewing preferences (wiki Epic 21 §4 21.6 and §5.1), kept on
 * the private profile record so they follow the account across devices.
 *
 * - `dailyLimitMinutes`: null = no reminder; otherwise one neutral card per day after that much
 *   foreground watch time (measured on the device). It never locks playback.
 * - `finiteLamahat`: Lamahat ends with "You're all caught up" after the admin-set count.
 *
 * No streaks, counters of time watched or badges are stored. The profile view is an allowlist, so
 * this never reaches public reads.
 */
import R2Repository from './r2Repo';

export const DAILY_LIMIT_MIN = 5;
export const DAILY_LIMIT_MAX = 600;

export interface IntentionalPreferences {
	dailyLimitMinutes: number | null;
	finiteLamahat: boolean;
	updatedAt: string | null;
}

export const DEFAULT_INTENTIONAL_PREFERENCES: IntentionalPreferences = { dailyLimitMinutes: null, finiteLamahat: false, updatedAt: null };

interface ProfileWithIntentional {
	id: string;
	intentional?: Partial<IntentionalPreferences>;
	dateModified?: string;
	[key: string]: unknown;
}

export function intentionalPreferencesOf(profile: { intentional?: Partial<IntentionalPreferences> } | null | undefined): IntentionalPreferences {
	const s = profile?.intentional ?? {};
	const limit = s.dailyLimitMinutes;
	return {
		dailyLimitMinutes: typeof limit === 'number' && Number.isInteger(limit) && limit >= DAILY_LIMIT_MIN && limit <= DAILY_LIMIT_MAX ? limit : null,
		finiteLamahat: s.finiteLamahat === true,
		updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
	};
}

export async function getIntentionalPreferences(profiles: R2Bucket | undefined, userId: string): Promise<IntentionalPreferences> {
	if (!profiles) return { ...DEFAULT_INTENTIONAL_PREFERENCES };
	return intentionalPreferencesOf(await new R2Repository<ProfileWithIntentional>(profiles).getObject(userId));
}

/** Merges `patch` on the fresh profile (conditional write); the rest of the profile is kept. */
export async function setIntentionalPreferences(
	profiles: R2Bucket,
	userId: string,
	email: string | undefined,
	patch: Partial<Omit<IntentionalPreferences, 'updatedAt'>>,
	now = new Date().toISOString(),
): Promise<IntentionalPreferences> {
	const updated = await new R2Repository<ProfileWithIntentional>(profiles).updateObject(
		userId,
		(profile) => {
			profile.intentional = { ...intentionalPreferencesOf(profile), ...patch, updatedAt: now };
			profile.dateModified = now;
			return true;
		},
		{ initial: () => ({ id: userId, email: email || 'unknown', dateCreated: now, dateModified: now, channels: [], subscribedTo: [] }) },
	);
	return intentionalPreferencesOf(updated);
}
