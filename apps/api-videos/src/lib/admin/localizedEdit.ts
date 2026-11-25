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

/** What an edit sends for one field: the plain text, the languages, or both (then they must agree). */
export interface UserTextEdit {
	plain?: string;
	map?: Record<string, string | undefined>;
}

/** Refuses a plain text that is not the map's own; call before anything is written. */
export function checkUserText(field: UserTextField, edit: UserTextEdit): void {
	if (edit.map === undefined) return;
	const text = cleanLocalizedText(edit.map, field.max, field.map);
	if (!text && field.required) throw new AdminError(400, 'invalid_request', `${field.map} requires en or ar`);
	if (edit.plain !== undefined && edit.plain.trim() !== primaryOf(text)) {
		throw new AdminError(400, 'invalid_request', `${field.plain} must match ${field.map}`);
	}
}

/** Applies it to the fresh record (inside its conditional write). */
export function applyUserText(fresh: Row, field: UserTextField, edit: UserTextEdit): void {
	const stored = fresh[field.map] && typeof fresh[field.map] === 'object' && !Array.isArray(fresh[field.map]) ? (fresh[field.map] as Record<string, unknown>) : undefined;
	const before = cleanLocalizedText(stored);
	if (edit.map !== undefined) {
		const text = cleanLocalizedText(edit.map, field.max, field.map);
		if (!text) {
			delete fresh[field.map];
			fresh[field.plain] = '';
			return;
		}
		if (before?.en && before.ar && (!text.en || !text.ar)) {
			throw new AdminError(400, 'invalid_request', `${field.map} has both languages and keeps both`);
		}
		fresh[field.map] = text;
		fresh[field.plain] = primaryOf(text);
		return;
	}
	if (edit.plain === undefined) return;
	// A caller that knows only the plain field changes the language that field shows; the other one stays
	if (before) {
		if (!edit.plain.trim()) delete fresh[field.map];
		else if (edit.plain.trim() !== String(fresh[field.plain] ?? '').trim()) {
			const lang: Lang = before.en ? 'en' : 'ar';
			fresh[field.map] = { ...before, [lang]: edit.plain.trim() };
		}
	}
	fresh[field.plain] = edit.plain;
}
