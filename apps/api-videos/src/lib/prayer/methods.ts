/**
 * Prayer calculation methods and per-country defaults (wiki Epic 21 §3). Ids are AlAdhan's
 * (https://api.aladhan.com/v1/methods). `method=auto` resolves to the city's country default;
 * admins can override any country on the Islamic experience settings page (story 21.1c), stored
 * under ISLAMIC_SETTINGS_KEY and read by readPrayerSettings.
 */

/** AlAdhan method ids we accept (6 is unused upstream; 99 = custom angles, not offered) */
export const PRAYER_METHOD_IDS = [0, 1, 2, 3, 4, 5, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23] as const;
export type PrayerMethodId = (typeof PRAYER_METHOD_IDS)[number];

/** Muslim World League where a country has no common national method */
export const FALLBACK_METHOD: PrayerMethodId = 3;

/** Shipped defaults; an admin override replaces a country's entry */
export const COUNTRY_METHOD_DEFAULTS: Readonly<Record<string, PrayerMethodId>> = Object.freeze({
	// Umm al-Qura, Makkah
	SA: 4, YE: 4,
	// Egyptian General Authority of Survey
	EG: 5, SD: 5, LY: 5, SY: 5, IQ: 5, LB: 5, PS: 5,
	// University of Islamic Sciences, Karachi
	PK: 1, IN: 1, BD: 1, AF: 1, NP: 1, LK: 1,
	// ISNA
	US: 2, CA: 2,
	// Gulf region and national authorities
	AE: 16, KW: 9, QA: 10, BH: 8, OM: 8,
	SG: 11, FR: 12, TR: 13, RU: 14, GB: 15, MY: 17, BN: 17, TN: 18, DZ: 19, ID: 20, MA: 21, PT: 22, JO: 23, IR: 7,
});

export function isPrayerMethodId(value: number): value is PrayerMethodId {
	return (PRAYER_METHOD_IDS as readonly number[]).includes(value);
}

export function resolveMethod(requested: 'auto' | number, country: string, overrides: Readonly<Record<string, number>> = {}): PrayerMethodId {
	if (requested !== 'auto') return requested as PrayerMethodId;
	const override = overrides[country];
	if (override !== undefined && isPrayerMethodId(override)) return override;
	return COUNTRY_METHOD_DEFAULTS[country] ?? FALLBACK_METHOD;
}

export type AsrMethod = 'standard' | 'hanafi';
export type HijriSource = 'HJCoSA' | 'UAQ';
