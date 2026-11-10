/**
 * Planning rules for restoring legacy profile fields (no I/O, unit-tested). Used by
 * the admin job "Restore legacy profile fields" (api-videos lib/admin/legacy-restore.ts)
 * and the CLI scripts/data/backfill-legacy-profiles.ts.
 *
 * Before SSO, video profiles were stored in R2 `profiles` under a 32-hex user id.
 * After SSO every user got a `usr_<hex>` id and a new profile; the old record was
 * left behind, and fields the user had set there (an Arabic name typed into the
 * plain first/last name fields, photos) were not carried over. The backfill only
 * FILLS fields that are empty on the usr_ profile; anything the user set since
 * is never overwritten. It also collapses the doubled slash old uploads saved
 * after the image host (`https://images.alummahnow.net//<key>`).
 */

export type Localized = Record<string, string>;

export interface StoredProfile {
	id: string;
	email?: string;
	firstName?: string;
	firstNameLocalized?: Localized;
	lastName?: string;
	lastNameLocalized?: Localized;
	displayName?: string;
	displayNameLocalized?: Localized;
	bio?: string;
	bioLocalized?: Localized;
	avatarUrl?: string;
	coverUrl?: string;
	timezone?: string;
	[key: string]: unknown;
}

export interface FieldChange {
	field: string;
	from: unknown;
	to: unknown;
}

export interface ProfilePlan {
	/** The usr_ profile's id */
	id: string;
	/** The legacy record it was filled from, if any */
	legacyId?: string;
	changes: FieldChange[];
	/** The usr_ profile with the changes applied (same object when there are none) */
	next: StoredProfile;
}

const LEGACY_ID = /^[0-9a-f]{32}$/;
export const isLegacyId = (key: string): boolean => LEGACY_ID.test(key);
export const isUsrId = (key: string): boolean => /^usr_[0-9a-f]{32}$/.test(key);

const ARABIC = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
/** True when the text is written in Arabic script (decides the `ar` vs default slot). */
export const isArabic = (text: string): boolean => ARABIC.test(text);

const blank = (v: unknown): boolean => typeof v !== 'string' || v.trim() === '';

/**
 * The web app's own fallback avatar, stored by an old bug in place of "no photo".
 * Treated as empty so a real legacy photo can fill it.
 */
const PLACEHOLDER_AVATARS = new Set(['/avatar.png']);

/** `https://host//key` → `https://host/key`; anything else unchanged. */
export function normalizeImageUrl(url: string): string {
	return url.replace(/^(https?:\/\/[^/]+)\/{2,}/i, '$1/');
}

const TEXT_FIELDS = ['firstName', 'lastName', 'displayName', 'bio'] as const;

/**
 * Plans the fill of one usr_ profile from its legacy record. Pure: `current` is
 * not modified. Every change fills an empty field; nothing set is replaced.
 */
export function planProfile(current: StoredProfile, legacy?: StoredProfile, options: { only?: ReadonlySet<string> } = {}): ProfilePlan {
	const next: StoredProfile = JSON.parse(JSON.stringify(current)) as StoredProfile;
	const changes: FieldChange[] = [];
	const set = (field: string, from: unknown, to: unknown) => {
		changes.push({ field, from, to });
	};
	// `only`: the fields an admin approved in the dry run; anything else is left alone
	const allowed = (field: string) => !options.only || options.only.has(field);

	if (legacy) {
		for (const field of TEXT_FIELDS) {
			const localizedKey = `${field}Localized` as const;
			const legacyMap = (legacy[localizedKey] as Localized | undefined) ?? {};
			const value = typeof legacy[field] === 'string' ? (legacy[field] as string).trim() : '';
			// The legacy plain field holds whatever the user typed: an Arabic name
			// belongs in the `ar` slot, anything else in the default field
			const fromPlain: Localized = value ? (isArabic(value) ? { ar: value } : { en: value }) : {};
			const wanted: Localized = { ...fromPlain, ...Object.fromEntries(Object.entries(legacyMap).filter(([, v]) => !blank(v))) };

			const map: Localized = { ...((next[localizedKey] as Localized | undefined) ?? {}) };
			let mapChanged = false;
			for (const [lang, text] of Object.entries(wanted)) {
				if (blank(map[lang]) && allowed(`${localizedKey}.${lang}`)) {
					set(`${localizedKey}.${lang}`, map[lang] ?? null, text);
					map[lang] = text;
					mapChanged = true;
				}
			}
			if (mapChanged) next[localizedKey] = map;

			// The plain field is the non-Arabic default (the web shows it when a
			// language has no localized value)
			const plain = wanted.en ?? (value && !isArabic(value) ? value : '');
			if (plain && blank(next[field]) && allowed(field)) {
				set(field, next[field] ?? null, plain);
				next[field] = plain;
			}
		}

		for (const field of ['avatarUrl', 'coverUrl'] as const) {
			const value = legacy[field];
			if (blank(value) || !allowed(field)) continue;
			const own = next[field];
			if (blank(own) || (field === 'avatarUrl' && PLACEHOLDER_AVATARS.has((own as string).trim()))) {
				const to = normalizeImageUrl((value as string).trim());
				set(field, own ?? null, to);
				next[field] = to;
			}
		}

		if (blank(next.timezone) && !blank(legacy.timezone) && allowed('timezone')) {
			set('timezone', next.timezone ?? null, legacy.timezone);
			next.timezone = legacy.timezone;
		}
	}

	for (const field of ['avatarUrl', 'coverUrl'] as const) {
		const value = next[field];
		if (typeof value === 'string' && normalizeImageUrl(value) !== value && allowed(field)) {
			const to = normalizeImageUrl(value);
			// A value filled above is already normalised; this is the user's own URL
			set(field, value, to);
			next[field] = to;
		}
	}

	return { id: current.id, legacyId: legacy?.id, changes, next: changes.length ? next : current };
}

export interface Pairing {
	pairs: { current: StoredProfile; legacy?: StoredProfile }[];
	/** Legacy records with no usr_ profile of the same email (nothing to fill) */
	unmatched: string[];
	/** Emails with several legacy records or several usr_ profiles (left alone) */
	ambiguous: string[];
}

const norm = (email: unknown): string => (typeof email === 'string' ? email.trim().toLowerCase() : '');

/**
 * Pairs every usr_ profile with the legacy record of the same email (when exactly
 * one each). The usr_ side is identified by the auth service's email for that
 * user id (`authEmails`: the address the user verified with a code), never by
 * the profile's stored `email`, which the profile update API lets a user edit:
 * pairing on it would let someone copy another person's legacy profile into
 * their own. A usr_ profile without an auth record is never paired. The legacy
 * side can only be the stored email; nothing writes legacy keys any more.
 */
export function pairProfiles(profiles: StoredProfile[], authEmails: ReadonlyMap<string, string>): Pairing {
	const byEmail = new Map<string, { usr: StoredProfile[]; legacy: StoredProfile[] }>();
	const pairs: Pairing['pairs'] = [];
	for (const p of profiles) {
		const kind = isUsrId(p.id) ? 'usr' : isLegacyId(p.id) ? 'legacy' : null;
		if (!kind) continue;
		const key = kind === 'usr' ? norm(authEmails.get(p.id)) : norm(p.email);
		if (!key) {
			if (kind === 'usr') pairs.push({ current: p });
			continue;
		}
		const entry = byEmail.get(key) ?? { usr: [], legacy: [] };
		entry[kind].push(p);
		byEmail.set(key, entry);
	}

	const unmatched: string[] = [];
	const ambiguous: string[] = [];
	for (const [email, { usr, legacy }] of byEmail) {
		if (legacy.length && !usr.length) {
			unmatched.push(...legacy.map((l) => l.id));
			continue;
		}
		if (legacy.length > 1 || (legacy.length && usr.length > 1)) {
			ambiguous.push(email);
			for (const current of usr) pairs.push({ current });
			continue;
		}
		for (const current of usr) pairs.push({ current, legacy: legacy[0] });
	}
	return { pairs, unmatched, ambiguous };
}
