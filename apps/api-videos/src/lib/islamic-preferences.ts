/**
 * The signed-in viewer's Islamic-experience preferences (wiki Epic 21 §5.1, owner decisions
 * E21-D1 to E21-D3), kept on the private profile record so they follow the account across devices.
 *
 * Only the chosen city's catalogue id leaves the device (E21-D3): never coordinates, a time zone
 * guess or a location history. Per-prayer minute adjustments and the Hijri shift are applied on
 * the device, so they never fragment the shared prayer cache. Reminders and auto-pause stay on
 * each device and are not stored here.
 *
 * The profile view (transformProfileToView) is an allowlist, so this never reaches public reads.
 */
import R2Repository from './r2Repo';

export const PRAYERS = ['fajr', 'sunrise', 'dhuhr', 'asr', 'maghrib', 'isha'] as const;
export type Prayer = (typeof PRAYERS)[number];
export const ADJUSTMENT_MAX_MINUTES = 60;
export const HIJRI_SHIFT_MAX_DAYS = 2;
/** GeoNames ids are positive integers */
export const CITY_ID_PATTERN = /^[1-9][0-9]{0,9}$/;

export interface IslamicPreferences {
	/** Bumped on every save; a write names the version it read (optimistic concurrency) */
	version: number;
	cityId: string | null;
	/** 'auto' = the city's country default, else a provider method id */
	calculationMethod: 'auto' | number;
	asrMethod: 'standard' | 'hanafi';
	adjustmentsMinutes: Record<Prayer, number>;
	hijriEnabled: boolean;
	hijriShiftDays: number;
	ramadanMode: boolean;
	jumuahReminder: boolean;
	updatedAt: string | null;
}

export const DEFAULT_ISLAMIC_PREFERENCES: IslamicPreferences = {
	version: 0,
	cityId: null,
	calculationMethod: 'auto',
	asrMethod: 'standard',
	adjustmentsMinutes: { fajr: 0, sunrise: 0, dhuhr: 0, asr: 0, maghrib: 0, isha: 0 },
	hijriEnabled: false,
	hijriShiftDays: 0,
	ramadanMode: false,
	jumuahReminder: false,
	updatedAt: null,
};

interface ProfileWithIslamic {
	id: string;
	islamic?: Partial<IslamicPreferences>;
	dateModified?: string;
	[key: string]: unknown;
}

const int = (value: unknown, min: number, max: number, fallback: number): number =>
	typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max ? value : fallback;

/** The stored preferences with every missing or malformed field at its default. */
export function islamicPreferencesOf(profile: { islamic?: Partial<IslamicPreferences> } | null | undefined): IslamicPreferences {
	const s = profile?.islamic ?? {};
	const adjustments = { ...DEFAULT_ISLAMIC_PREFERENCES.adjustmentsMinutes };
	for (const prayer of PRAYERS) adjustments[prayer] = int(s.adjustmentsMinutes?.[prayer], -ADJUSTMENT_MAX_MINUTES, ADJUSTMENT_MAX_MINUTES, 0);
	return {
		version: int(s.version, 0, Number.MAX_SAFE_INTEGER, 0),
		cityId: typeof s.cityId === 'string' && CITY_ID_PATTERN.test(s.cityId) ? s.cityId : null,
		calculationMethod: s.calculationMethod === 'auto' || s.calculationMethod === undefined ? 'auto' : int(s.calculationMethod, 0, 99, -1) >= 0 ? (s.calculationMethod as number) : 'auto',
		asrMethod: s.asrMethod === 'hanafi' ? 'hanafi' : 'standard',
		adjustmentsMinutes: adjustments,
		hijriEnabled: s.hijriEnabled === true,
		hijriShiftDays: int(s.hijriShiftDays, -HIJRI_SHIFT_MAX_DAYS, HIJRI_SHIFT_MAX_DAYS, 0),
		ramadanMode: s.ramadanMode === true,
		jumuahReminder: s.jumuahReminder === true,
		updatedAt: typeof s.updatedAt === 'string' ? s.updatedAt : null,
	};
}

export async function getIslamicPreferences(profiles: R2Bucket | undefined, userId: string): Promise<IslamicPreferences> {
	if (!profiles) return { ...DEFAULT_ISLAMIC_PREFERENCES };
	return islamicPreferencesOf(await new R2Repository<ProfileWithIslamic>(profiles).getObject(userId));
}

export type IslamicPreferencesPatch = Partial<Omit<IslamicPreferences, 'version' | 'updatedAt' | 'adjustmentsMinutes'>> & {
	adjustmentsMinutes?: Partial<Record<Prayer, number>>;
};

export class PreferencesConflict extends Error {
	constructor(readonly current: IslamicPreferences) {
		super('version_conflict');
	}
}

/**
 * Applies `patch` when `expectedVersion` matches the stored version (0 for a profile that never
 * saved them); otherwise throws PreferencesConflict with the stored preferences. The write is a
 * conditional update of the profile record, so a concurrent edit of another profile field is kept.
 */
export async function setIslamicPreferences(
	profiles: R2Bucket,
	userId: string,
	email: string | undefined,
	expectedVersion: number,
	patch: IslamicPreferencesPatch,
	now = new Date().toISOString(),
): Promise<IslamicPreferences> {
	let conflict: IslamicPreferences | null = null;
	const updated = await new R2Repository<ProfileWithIslamic>(profiles).updateObject(
		userId,
		(profile) => {
			const current = islamicPreferencesOf(profile);
			if (current.version !== expectedVersion) {
				conflict = current;
				return false;
			}
			conflict = null;
			const next: IslamicPreferences = {
				...current,
				...patch,
				adjustmentsMinutes: { ...current.adjustmentsMinutes, ...(patch.adjustmentsMinutes ?? {}) },
				version: current.version + 1,
				updatedAt: now,
			};
			profile.islamic = next;
			profile.dateModified = now;
			return true;
		},
		{
			initial: () => ({ id: userId, email: email || 'unknown', dateCreated: now, dateModified: now, channels: [], subscribedTo: [] }),
		},
	);
	if (conflict) throw new PreferencesConflict(conflict);
	return islamicPreferencesOf(updated);
}
