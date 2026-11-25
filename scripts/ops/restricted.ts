/**
 * Restricted areas are left out of the error report, sealed or not: their log lines, requests, error groups and
 * needs-action items, by tag, path, source file and words. The report says how many, never which. Everything else
 * keeps its fields. A log line with neither a tag nor a path cannot be placed: only its message's template is printed.
 */

/** Every tag these areas log with (a test greps the source files for a new one). */
const TAGS = /(?:^|\s)\[(?:CSAM|ChildSafety|SafetyMail|ReportRetention|Guest[-_ ]?Report|ImageOwners)\]/i;
/** Source files of these areas, as a stack frame or a module field names them (the csam files are in WORDS). */
const MODULES = /lib\/moderation\/(?:childSafety|safetyMail|retention|takedown)\b|endpoints\/moderation\/GuestReportSubmit\b|lib\/guest-report-limits\b/i;
/** The last net, over every key and string value. */
const WORDS = /csam|child[-_ ]?safety|take[-_ ]?down/i;
/** With everything below them; a locale in front of a page's path does not matter. */
const PATHS = ['/api/csam', '/internal/csam', '/moderation/csam', '/internal/guest-reports', '/webhooks/cloudflare/notifications'];

export function restrictedPath(path: unknown): boolean {
	if (typeof path !== 'string' || !path) return false;
	const p = path.toLowerCase().replace(/^https?:\/\/[^/]+/, '').split(/[?#]/)[0]!.replace(/\/{2,}/g, '/').replace(/^\/(?:[a-z]{2}|:locale)(?=\/)/, '');
	return WORDS.test(p) || PATHS.some((prefix) => p === prefix || p.startsWith(`${prefix}/`));
}

/** Any text of these areas: a tag, a source file, the words, or one of the paths ("slow request GET /api/…"). */
export function restrictedText(value: unknown): boolean {
	const raw = typeof value === 'string' ? value : JSON.stringify(value ?? null) ?? '';
	// Paths without their host, and tags at the start of any value
	const text = raw.replace(/https?:\/\/[^\s/"'\\]{1,255}/gi, ' ').replace(/\\?"/g, ' ');
	return TAGS.test(text) || MODULES.test(text) || WORDS.test(text) || (text.match(/\/[A-Za-z0-9_:.~%/-]{2,300}/g) ?? []).some(restrictedPath);
}

/** "[Media] Job # failed" of "[Media] Job 123 failed": ids, numbers, quoted text and addresses are cut. */
export function messageTemplate(message: unknown): string {
	return String(message ?? '')
		.slice(0, 600)
		.replace(/"[^"]{0,200}"?|“[^”]{0,200}”?|'[^']{0,200}'/g, '…')
		.replace(/https?:\S{1,300}/g, '…')
		.replace(/\S*[@/\\]\S*/g, '…')
		.replace(/\S*\d\S*/g, '#')
		.slice(0, 160);
}

export interface LogEvent {
	source?: unknown;
	$metadata?: { message?: unknown; error?: unknown; level?: unknown; timestamp?: unknown };
	$workers?: { event?: { request?: { url?: unknown; path?: unknown } }; scriptName?: unknown; requestId?: unknown };
}

const TAG = /^\s*\[[A-Za-z][A-Za-z0-9 _.:-]{0,60}\]/;

/** What of a log line may be in the report. `path` is the request's path, '' without one. */
export function placeLog(e: LogEvent, path: string): 'restricted' | 'template' | 'full' {
	const source = e.source as { message?: unknown; msg?: unknown } | undefined;
	const message = String(e.$metadata?.message ?? source?.message ?? source?.msg ?? '');
	if (restrictedPath(path) || restrictedText(message) || restrictedText(e.$metadata?.error) || restrictedText(e.source)) return 'restricted';
	return path || TAG.test(message) ? 'full' : 'template';
}

export function pathOf(url: unknown): string {
	return String(url ?? '').replace(/^https?:\/\/[^/]+/, '').split('?')[0]!.split('#')[0]!;
}

export const requestPath = (e: LogEvent): string => pathOf(e.$workers?.event?.request?.url ?? e.$workers?.event?.request?.path);

/** The events of one Worker that may be in a report. A restricted request takes all its lines with it. */
export function placed<T extends LogEvent>(events: T[]): { e: T; template: boolean }[] {
	const of = events.map((e) => ({ e, place: placeLog(e, requestPath(e)) }));
	const requests = new Set(of.filter((x) => x.place === 'restricted').map((x) => x.e.$workers?.requestId).filter(Boolean));
	return of.filter((x) => x.place !== 'restricted' && !requests.has(x.e.$workers?.requestId)).map((x) => ({ e: x.e, template: x.place === 'template' }));
}

/** Rows without the restricted ones. */
export function unrestricted<T>(rows: T[]): { rows: T[]; leftOut: number } {
	const kept = rows.filter((row) => !restrictedText(row));
	return { rows: kept, leftOut: rows.length - kept.length };
}

/** Counts of what was left out; null: a count could not be read. */
export interface LeftOut {
	lines: number;
	groups: number | null;
	items: number | null;
}

/** Numbers only, so a quiet report and a filtered one can be told apart. */
export const leftOutLine = (n: LeftOut) => `${n.lines} restricted lines, ${n.groups ?? 'unknown'} restricted groups, ${n.items ?? 'unknown'} restricted items left out`;
