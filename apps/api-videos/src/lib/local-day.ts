/**
 * Calendar days in the viewer's time zone, for Studio analytics.
 *
 * Studio sends its IANA zone (`tz`), so "today" and the day an event falls on
 * follow the viewer's clock, the same way admin times do. Timestamped events
 * (likes, comments, subscriptions) are bucketed by their local day. View and
 * watch-time counters are stored per UTC day by the processor and keep their
 * date: a UTC day overlaps most of the local day with the same date in every
 * zone between UTC-12 and UTC+12.
 */

import { dateTimeFormat } from '@al-ummah/shared-types';

const DAY_MS = 24 * 60 * 60 * 1000;

// Shared cached formatters (locale-format; bounded cache). Only canonical zone names reach them
// (validTimeZone), since `tz` comes from the request.
const dayFormat = (timeZone: string) => dateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' });
const clockFormat = (timeZone: string) =>
	dateTimeFormat('en', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' });

function parts(format: Intl.DateTimeFormat, ms: number): Record<string, number> {
	const out: Record<string, number> = {};
	for (const part of format.formatToParts(new Date(ms))) if (part.type !== 'literal') out[part.type] = Number(part.value);
	return out;
}

/**
 * The runtime's canonical name of an IANA zone ("america/new_york" → "America/New_York"), else UTC:
 * an unknown or missing `tz` never fails a request. Offsets ("+05:30") are refused, so the caches
 * only ever hold real zone names.
 */
export function validTimeZone(timeZone?: string | null): string {
	if (!timeZone || timeZone.length > 64 || !/^[A-Za-z][A-Za-z0-9_+\-]*(\/[A-Za-z0-9_+\-]+)*$/.test(timeZone)) return 'UTC';
	try {
		const canonical = dateTimeFormat('en', { timeZone }).resolvedOptions().timeZone;
		return canonical === 'Etc/UTC' || canonical === 'Etc/GMT' ? 'UTC' : canonical;
	} catch {
		return 'UTC';
	}
}

/** YYYY-MM-DD of the instant `ms` on the wall calendar of `timeZone`. */
export function localDayKey(ms: number, timeZone = 'UTC'): string {
	if (timeZone === 'UTC') return new Date(ms).toISOString().slice(0, 10);
	const p = parts(dayFormat(timeZone), ms);
	return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/** Wall clock minus UTC at the instant `ms`, in ms (-5 h for New York in winter). */
function offsetMs(ms: number, timeZone: string): number {
	const p = parts(clockFormat(timeZone), ms);
	return Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second) - (ms - (((ms % 1000) + 1000) % 1000));
}

/** Epoch ms of the local midnight that starts `day` (YYYY-MM-DD) in `timeZone`. */
export function localDayStart(day: string, timeZone = 'UTC'): number {
	const wall = Date.parse(`${day}T00:00:00Z`);
	if (timeZone === 'UTC') return wall;
	// Two passes settle the offset across a DST change on that day
	let t = wall - offsetMs(wall, timeZone);
	t = wall - offsetMs(t, timeZone);
	return t;
}

/** Epoch ms of the last millisecond of `day` in `timeZone`. */
export function localDayEnd(day: string, timeZone = 'UTC'): number {
	const next = new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
	return localDayStart(next, timeZone) - 1;
}
