/**
 * Pure planning logic of the legacy-channel migration (issue #245). No I/O and
 * no imports, so `node --experimental-strip-types --test` runs its tests; the
 * runner (assign-legacy-channel.ts) does the Cloudflare calls.
 *
 * Legacy imported videos have `channelId: null`, a placeholder `userId` and the
 * channel only as a display name in `channel`. The migration moves every such
 * video of one legacy channel name onto a real channel owned by a real user.
 */

/** Placeholder owner of every imported legacy video. */
export const LEGACY_PLACEHOLDER_USER = 'd3b07384-d9a7-4f3b-8a1d-6c7b8b8f8f8f';

export type Json = Record<string, unknown>;

export interface LegacyMatch {
	/** Legacy display name in `video.channel` (compared trimmed, case-insensitively). */
	channelName: string;
	/** Legacy placeholder owner. */
	legacyUserId: string;
}

export interface Target {
	channelId: string;
	ownerId: string;
}

function sameName(a: unknown, b: string): boolean {
	return typeof a === 'string' && a.trim().toLocaleLowerCase() === b.trim().toLocaleLowerCase();
}

/** A legacy video of the given channel name that has not been migrated. */
export function isLegacyCandidate(video: Json | null | undefined, match: LegacyMatch): boolean {
	if (!video || typeof video !== 'object' || typeof video.id !== 'string') return false;
	if (typeof video.channelId === 'string' && video.channelId) return false;
	return video.userId === match.legacyUserId && sameName(video.channel, match.channelName);
}

/** Already assigned to the target (a re-run: re-sync its indexes, change nothing). */
export function isMigrated(video: Json | null | undefined, target: Target): boolean {
	return !!video && video.channelId === target.channelId && video.userId === target.ownerId;
}

/**
 * The migrated copy of a legacy video, or null when it is not a candidate.
 * Only `channelId` and `userId` change; the legacy `channel` name stays as the
 * display fallback (search payloads read it as channelName).
 */
export function migrateVideo(video: Json, match: LegacyMatch, target: Target): Json | null {
	if (!isLegacyCandidate(video, match)) return null;
	return { ...video, channelId: target.channelId, userId: target.ownerId };
}

/**
 * Same default handle candidates as api-videos lib/channelHandles.ts
 * defaultHandleCandidates (Latin slug of the name, then with an id suffix,
 * then channel-<id prefix>). Duplicated because that module imports the
 * worker logger.
 */
export function handleCandidates(name: string, id: string): string[] {
	const idPart = id.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
	const base = (name || '')
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^A-Za-z0-9._-]+/g, '')
		.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, '')
		.slice(0, 25);
	const out: string[] = [];
	if (base) out.push(base, `${base}-${idPart.slice(0, 4)}`, `${base}-${idPart.slice(0, 8)}`);
	out.push(`channel-${idPart.slice(0, 8)}`, `channel-${idPart.slice(0, 16)}`);
	return [...new Set(out)].filter((h) => h.length >= 3 && h.length <= 30 && /^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$/.test(h));
}

/** Index key of a handle in the channel-tabs bucket (lib/channelHandles.ts handleKey). */
export function handleKey(handle: string): string {
	return `channel-handles/${handle.trim().replace(/^@+/, '').toLowerCase()}`;
}

/** The most common https channel thumbnail of the legacy videos (their old channel avatar). */
export function pickAvatar(videos: Json[]): string | undefined {
	const counts = new Map<string, number>();
	for (const v of videos) {
		const url = v.channelThumbnailUrl;
		if (typeof url === 'string' && /^https:\/\/\S+$/.test(url)) counts.set(url, (counts.get(url) ?? 0) + 1);
	}
	let best: string | undefined;
	let n = 0;
	for (const [url, c] of counts) if (c > n) [best, n] = [url, c];
	return best;
}

/** A channel record exactly as api-videos ChannelCreate stores it. */
export function buildChannel(input: {
	id: string;
	now: string;
	ownerId: string;
	email: string;
	name: string;
	avatarUrl?: string;
	handle?: string;
}): Json {
	return {
		id: input.id,
		dateCreated: input.now,
		dateModified: input.now,
		userId: input.ownerId,
		email: input.email,
		name: input.name,
		nameLocalized: { en: input.name, ar: '' },
		description: '',
		descriptionLocalized: { en: '', ar: '' },
		isMain: false,
		...(input.avatarUrl ? { avatarUrl: input.avatarUrl } : {}),
		playlists: [],
		videos: [],
		subscribers: [],
		subscriptions: [],
		likes: [],
		...(input.handle ? { handle: input.handle } : {}),
	};
}

// ---------------------------------------------------------------------------
// Rollups (D1 analytics_daily, apps/processor/src/lib/analytics-counters.ts)
// ---------------------------------------------------------------------------

export interface CounterRow {
	entityType: 'video' | 'channel' | 'post';
	entityId: string;
	day: string;
	metric: string;
	dim?: string;
	value: number;
}

const SEP = '\u001f';

export function rowKey(r: Pick<CounterRow, 'entityType' | 'entityId' | 'day' | 'metric' | 'dim'>): string {
	return [r.entityType, r.entityId, r.day, r.metric, r.dim ?? ''].join(SEP);
}

function parseKey(key: string): Omit<CounterRow, 'value'> {
	const [entityType, entityId, day, metric, dim] = key.split(SEP);
	return { entityType: entityType as CounterRow['entityType'], entityId, day, metric, dim };
}

/** Sum rows by (entity, day, metric, dim). */
export function sumRows(rows: Iterable<CounterRow>): Map<string, number> {
	const out = new Map<string, number>();
	for (const r of rows) {
		if (!(r.value > 0)) continue;
		const k = rowKey(r);
		out.set(k, (out.get(k) ?? 0) + r.value);
	}
	return out;
}

/**
 * Increments that bring the rollups of the migrated videos and of their new
 * channel up to what the message archive holds.
 *
 * - `archive`: video rows recomputed from the archived VideoView /
 *   VideoWatchTime messages of the migrated videos (the processor's own
 *   viewIncrements / watchTimeIncrements).
 * - `effective`: what readers see now for those videos and the channel, i.e.
 *   the D1 rows plus legacy R2 rollup documents not imported yet.
 *
 * A video row becomes max(archive, effective); the channel row becomes the sum
 * of its videos' rows (every view since the migration adds to both, so the sum
 * stays right). Only positive differences are written, as additive upserts:
 * a re-run computes zero, and a legacy document imported later still adds up
 * to the same total. The new channel's videos must all be in `videoIds`.
 */
export function rollupDeltas(archive: Map<string, number>, effective: Map<string, number>, channelId: string, videoIds: Set<string>): CounterRow[] {
	const out: CounterRow[] = [];
	const videoKeys = new Set<string>();
	for (const k of [...archive.keys(), ...effective.keys()]) {
		const p = parseKey(k);
		if (p.entityType === 'video' && videoIds.has(p.entityId)) videoKeys.add(k);
	}
	const channelTarget = new Map<string, number>();
	for (const k of [...videoKeys].sort()) {
		const have = effective.get(k) ?? 0;
		const want = Math.max(archive.get(k) ?? 0, have);
		if (want > have) out.push({ ...parseKey(k), value: round(want - have) });
		const p = parseKey(k);
		const ck = rowKey({ ...p, entityType: 'channel', entityId: channelId });
		channelTarget.set(ck, (channelTarget.get(ck) ?? 0) + want);
	}
	for (const [ck, want] of [...channelTarget].sort()) {
		const have = effective.get(ck) ?? 0;
		if (want > have) out.push({ ...parseKey(ck), value: round(want - have) });
	}
	return out.filter((r) => r.value > 0);
}

function round(n: number): number {
	return Math.round(n * 1000) / 1000;
}

/** R2 key (messages bucket) of the backup of one object changed by a run. */
export function backupKey(env: string, runId: string, bucket: string, id: string): string {
	return `migrations/issue-245/${env}/${runId}/${bucket}/${id}.json`;
}
