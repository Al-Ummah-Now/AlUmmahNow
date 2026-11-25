/**
 * A person's own text (channel name and description, video title and description) as staff edit it.
 *
 * Policy (wiki guides/localized-fields.md): staff who CREATE something give both languages. Staff who EDIT a
 * user's text that has one language may leave it at one: the missing language is offered, not required, and
 * text nobody touched is not rewritten. Text that has both languages keeps both.
 */
import { AdminError } from './service';

type Row = Record<string, any>;
const LANGS = ['en', 'ar'] as const;
type Lang = (typeof LANGS)[number];
export type UserText = Partial<Record<Lang, string>>;

/** The languages of a stored or sent map that have text, trimmed; undefined when there is none. */
export function cleanLocalizedText(raw: unknown, max?: number, field = 'localized'): Record<string, string> | undefined {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
	const out: Record<string, string> = {};
	for (const lang of LANGS) {
		const value = (raw as Record<string, unknown>)[lang];
		if (typeof value !== 'string' || !value.trim()) continue;
		const trimmed = value.trim();
		if (max && trimmed.length > max) throw new AdminError(400, 'invalid_request', `${field}.${lang} must be at most ${max} characters`);
		out[lang] = trimmed;
	}
	return Object.keys(out).length ? out : undefined;
}

/** The plain field that goes with a map: English when there is some, else Arabic. */
export const primaryOf = (text: UserText | undefined): string => text?.en || text?.ar || '';

export interface UserTextField {
	plain: string;
	map: string;
	max: number;
	/** One language at least */
	required: boolean;
}

/**
 * What an edit sends for one field: the plain text, the languages it changes, or both (then they must agree).
 * A language that is absent is left as it is; an empty one is taken away; an empty map clears the whole text.
 */
export interface UserTextEdit {
	plain?: string;
	map?: Record<string, string | undefined>;
}

/** Refuses texts that can never be saved (too long); the rest depends on the record (applyUserText). */
export function checkUserText(field: UserTextField, edit: UserTextEdit): void {
	if (edit.map !== undefined) cleanLocalizedText(edit.map, field.max, field.map);
}

/** A text stored without languages is in the one of its own script, as the admin's form shows it. */
const languageOf = (plain: string): Lang => (/[\u0600-\u06FF]/.test(plain) ? 'ar' : 'en');

/**
 * Applies it to the fresh record (inside its conditional write), so edits of different languages both survive.
 * Translations the record holds in other languages stay, unless the whole text is cleared.
 */
export function applyUserText(fresh: Row, field: UserTextField, edit: UserTextEdit): void {
	const stored = fresh[field.map] && typeof fresh[field.map] === 'object' && !Array.isArray(fresh[field.map]) ? (fresh[field.map] as Record<string, unknown>) : undefined;
	const before = cleanLocalizedText(stored);
	const others = Object.fromEntries(Object.entries(stored ?? {}).filter(([lang]) => !(LANGS as readonly string[]).includes(lang)));
	if (edit.map !== undefined) {
		const sent = cleanLocalizedText(edit.map, field.max, field.map) ?? {};
		const plain = String(fresh[field.plain] ?? '').trim();
		// The plain text of a record whose languages are all others is one of those, not English or Arabic
		const merged: Record<string, string> = before ? { ...before } : plain && !Object.values(others).includes(plain) ? { [languageOf(plain)]: plain } : {};
		for (const lang of LANGS) {
			if (edit.map[lang] === undefined) continue;
			if (sent[lang]) merged[lang] = sent[lang];
			else delete merged[lang];
		}
		const cleared = Object.keys(edit.map).length === 0 || (!merged.en && !merged.ar);
		if (cleared && field.required) throw new AdminError(400, 'invalid_request', `${field.map} requires en or ar`);
		if (!cleared && before?.en && before.ar && (!merged.en || !merged.ar)) {
			throw new AdminError(400, 'invalid_request', `${field.map} has both languages and keeps both`);
		}
		const shown = cleared ? '' : primaryOf(merged);
		if (edit.plain !== undefined && edit.plain.trim() !== shown) {
			throw new AdminError(400, 'invalid_request', `${field.plain} must match ${field.map}`);
		}
		if (cleared) delete fresh[field.map];
		else fresh[field.map] = { ...others, ...merged };
		fresh[field.plain] = shown;
		return;
	}
	if (edit.plain === undefined) return;
	const text = edit.plain.trim();
	if (!text) {
		// The whole text goes
		delete fresh[field.map];
	} else if (stored && text !== String(fresh[field.plain] ?? '').trim()) {
		// A caller that knows only the plain field changes the language that field shows; the others stay
		const shown = String(fresh[field.plain] ?? '').trim();
		const lang = before ? (before.en ? 'en' : 'ar') : Object.keys(others).find((l) => others[l] === shown);
		if (lang) fresh[field.map] = { ...others, ...before, [lang]: text };
	}
	fresh[field.plain] = edit.plain;
}
