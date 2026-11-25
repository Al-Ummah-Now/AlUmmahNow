/**
 * The public part of the ops reports (workflow log, job summary): an allow list. Every printed value is a word of
 * a fixed set, a number, a time, a group id or a route made of known words; anything else prints as "other" or "–".
 * No message text, paths, titles, JSON or ids. The full report is sealed (seal.ts).
 */

const APPS = ['web', 'admin-web', 'api-videos', 'admin-api', 'processor', 'scheduler', 'websocket', 'cost-monitor', 'short-links', 'auth', 'status', 'tools', 'media'];
const KINDS = ['boundary', 'unhandled', 'rejection', 'chunk', 'skew', 'fetch', 'http', 'player', 'upload', 'action', 'caught'];
/** Error class names of the platform, our apps and .NET; a browser report can hold any other text as its name. */
const NAMES = [
	'Error', 'TypeError', 'ReferenceError', 'RangeError', 'SyntaxError', 'URIError', 'AggregateError', 'AbortError', 'TimeoutError', 'NetworkError', 'SecurityError',
	'NotAllowedError', 'NotFoundError', 'NotSupportedError', 'NotReadableError', 'InvalidStateError', 'InvalidAccessError', 'DataCloneError', 'QuotaExceededError', 'DOMException',
	'ChunkLoadError', 'LoggedError', 'D1Error', 'TransientStorageError', 'ConcurrentUpdateError', 'R2TranscodeFailed', 'MediaError',
	'Exception', 'IOException', 'HttpRequestException', 'TaskCanceledException', 'OperationCanceledException', 'NotImplementedException', 'NullReferenceException',
	'InvalidOperationException', 'ArgumentException', 'ArgumentNullException', 'UnauthorizedAccessException', 'COMException', 'TusException', 'ImportApiException', 'StepFailedException', 'LocalEncodeException',
];
const SOURCES = ['queue', 'dlq', 'processing', 'email', 'ai', 'admin-job', 'scheduler', 'upload', 'ops', 'status'];
const ITEM_TYPES = [
	'video', 'user', 'channel', 'report', 'review', 'setting', 'settings', 'invite', 'admin-job', 'app-release', 'billing-job', 'channel-move-mail', 'contact-message', 'dead-letter',
	'media-backfill', 'media-backfill-run', 'media-bunny-removal', 'ops-cost', 'ops-resource', 'playlist-add', 'quran-sync', 'status-component', 'status-incident', 'theme-package', 'tier-change', 'tier-request',
];
/** Static words of our routes. A route is printed only as these words and :params. */
const SEGMENTS = new Set(
	('account admin analytics api apps audio auth batches callback captions categories channel channels chunks clips comments community complete content costs create ' +
		'delivery discovery download embed encode errors events explore feed feeds features files hash health help history home images import imports initiate internal items jobs ' +
		'library list live login logout media messages notifications og p playback playlist playlists posts post privacy processing profile profiles progress public quran ' +
		'ranking realtime report reports resume search security sessions settings shorts sidecars sitemaps site studio subscriptions subtitles system thumb token tus unread-count ' +
		'upload uploads users v video videos views watch-history watch-later watch ws').split(' '),
);

const ONE_OF = (list: readonly string[]) => (v: unknown) => (list.includes(v as string) ? (v as string) : 'other');
export const publicApp = ONE_OF(APPS);
export const publicKind = ONE_OF(KINDS);
export const publicName = ONE_OF(NAMES);
export const publicSource = ONE_OF(SOURCES);
export const publicItemType = ONE_OF(ITEM_TYPES);
export const publicGroupId = (v: unknown) => (typeof v === 'string' && /^eg_[0-9a-f]{16}$/.test(v) ? v : '–');
export const publicCount = (v: unknown) => (Number.isSafeInteger(Number(v)) && Number(v) >= 0 && v !== null && v !== '' ? String(Number(v)) : '–');
export const publicStatus = (v: unknown) => (/^[1-5]\d\d$/.test(String(v)) ? String(v) : '–');
/** To the minute: enough to match a deploy, too little to pick out a request. */
export const publicTime = (v: unknown) => {
	const t = typeof v === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(v) ? Date.parse(v) : v instanceof Date ? v.getTime() : NaN;
	return Number.isFinite(t) ? `${new Date(t).toISOString().slice(0, 16)}Z` : '–';
};
export const publicRoute = (v: unknown) => {
	if (typeof v !== 'string' || !v.startsWith('/') || v.length > 120) return '–';
	const parts = v.slice(1).split('/').slice(0, 8);
	return `/${parts.map((s) => (s === ':id' || s === ':locale' || SEGMENTS.has(s) ? s : ':other')).join('/')}`;
};
const ENVS = ['production', 'stage', 'qa'];
export const publicEnv = ONE_OF(ENVS);

export interface GroupRow {
	id?: unknown; app?: unknown; kind?: unknown; name?: unknown; route?: unknown; status?: unknown; http_status?: unknown; occurrences?: unknown; first_seen?: unknown; last_seen?: unknown; test?: unknown;
}
export interface ActionRow { app?: unknown; source?: unknown; item_type?: unknown; updated_at?: unknown }
export interface LogCount { app: string; warn: number; error: number; readable: boolean }

export interface ErrorsData {
	env: unknown;
	since: Date;
	until: Date;
	groups: GroupRow[] | null;
	actions: ActionRow[] | null;
	collectorFailures: number | null;
	logs: LogCount[];
}

/** One group without its id and times, e.g. "api-videos http other /api/watch-history/:id/progress status 500". */
const groupWords = (g: GroupRow) => `${publicApp(g.app)} ${publicKind(g.kind)} ${publicName(g.name)} ${publicRoute(g.route)} status ${publicStatus(g.http_status)}`;

/** Open needs-action items by kind. */
function actionKinds(actions: ActionRow[]): Map<string, number> {
	const kinds = new Map<string, number>();
	for (const a of actions) {
		const key = `${publicApp(a.app)} ${publicSource(a.source)} ${publicItemType(a.item_type)}`;
		kinds.set(key, (kinds.get(key) ?? 0) + 1);
	}
	return kinds;
}

/** The same allow list as data, for the routine that compares runs (error-routine.ts). Null: not readable. */
export interface ErrorSummary {
	groups: { id: string; line: string; test: boolean }[] | null;
	actions: Record<string, number> | null;
}

export function publicSummary(d: Pick<ErrorsData, 'groups' | 'actions'>): ErrorSummary {
	return {
		groups: d.groups?.map((g) => ({ id: publicGroupId(g.id), line: `${groupWords(g)} count ${publicCount(g.occurrences)}`, test: !!g.test })).filter((g) => g.id !== '–') ?? null,
		actions: d.actions ? Object.fromEntries([...actionKinds(d.actions)].sort()) : null,
	};
}

/** The public lines of prod-errors. */
export function publicErrors(d: ErrorsData): string[] {
	const out = [`# Errors: ${publicEnv(d.env)}, ${publicTime(d.since)} to ${publicTime(d.until)}`, '', '## Error groups'];
	if (!d.groups) out.push('not readable');
	else {
		out.push(`${d.groups.length} groups`);
		for (const g of d.groups) {
			out.push(`- ${publicGroupId(g.id)} ${groupWords(g)} count ${publicCount(g.occurrences)} first ${publicTime(g.first_seen)} last ${publicTime(g.last_seen)}${g.test ? ' test' : ''}`);
		}
	}
	out.push('', '## Open needs-action items');
	if (!d.actions) out.push('not readable');
	else {
		out.push(`${d.actions.length} open`);
		for (const [key, n] of [...actionKinds(d.actions)].sort()) out.push(`- ${key} count ${n}`);
	}
	out.push('', '## Cost collector', d.collectorFailures === null ? 'not readable' : `${publicCount(d.collectorFailures)} failed runs`);
	out.push('', '## Logs (events)');
	for (const l of d.logs) out.push(l.readable ? `- ${publicApp(l.app)} warn ${publicCount(l.warn)} error ${publicCount(l.error)}` : `- ${publicApp(l.app)} not readable`);
	return out;
}

export interface MediaData {
	env: unknown;
	since: Date;
	until: Date;
	deployments: number | null;
	backlog: { queue: number | null; dlq: number | null };
	containers: number | null;
	starts: { n: number; p50: number; p95: number } | null;
	logs: LogCount[];
}

/** The public lines of media-diagnostics. */
export function publicMedia(d: MediaData): string[] {
	const n = (v: number | null) => (v === null ? 'not readable' : publicCount(Math.round(v)));
	return [
		`# Media diagnostics: ${publicEnv(d.env)}, ${publicTime(d.since)} to ${publicTime(d.until)}`,
		'',
		`- deployments read ${n(d.deployments)}`,
		`- transcode queue backlog ${n(d.backlog.queue)}`,
		`- transcode dead letters ${n(d.backlog.dlq)}`,
		`- container applications ${n(d.containers)}`,
		d.starts ? `- transcode starts (30 days) ${publicCount(d.starts.n)}, p50 ${publicCount(Math.round(d.starts.p50))} ms, p95 ${publicCount(Math.round(d.starts.p95))} ms` : '- transcode starts not readable',
		...d.logs.map((l) => (l.readable ? `- logs ${publicApp(l.app)} warn ${publicCount(l.warn)} error ${publicCount(l.error)}` : `- logs ${publicApp(l.app)} not readable`)),
	];
}
