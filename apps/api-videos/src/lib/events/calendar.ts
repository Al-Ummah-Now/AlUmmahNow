/**
 * Unified online Event Calendar data access (Epic 22, E22-D7).
 *
 * Reads the single upcoming-event model shared with Epic 17 (`SEARCH_DB.live_stream_metadata` +
 * `livestream:<id>` in R2 + `NOTIFICATIONS_DB.live_reminders`), falling back cleanly to the indexed
 * `content_ownership` (`kind = 'stream'`) table when `live_stream_metadata` has not migrated yet.
 * Every D1 query uses a composite index; zero full-table scans.
 */
import {
	isLiveEventType,
	isLiveStreamKind,
	type CalendarEventItem,
	type LiveEventType,
	type LiveStreamKind,
} from '@al-ummah/shared-types';
import R2Repository, { NonVideoRepository } from '../r2Repo';
import { logger } from '../logger';

export const EVENT_CALENDAR_PAGE_MAX = 50;
/** Unstarted scheduled streams older than 6 hours are hidden from default upcoming views. */
export const PAST_SCHEDULED_GRACE_MS = 6 * 60 * 60 * 1000;
const MAX_SCAN_PAGES = 3;

export interface EventCalendarEnv {
	SEARCH_DB?: D1Database;
	NOTIFICATIONS_DB?: D1Database;
	videos: R2Bucket;
	channels: R2Bucket;
}

export interface ListCalendarEventsOptions {
	channelId?: string | null;
	eventType?: LiveEventType | null;
	kind?: LiveStreamKind | null;
	/** Filters to the viewer's up to 90 most recently subscribed channels (bounded by D1 bind limits). */
	subscribedOnly?: boolean;
	fromMs?: number | null;
	toMs?: number | null;
	limit?: number;
	cursor?: string | null;
	viewerId?: string | null;
	nowMs?: number;
}

interface LiveStreamMetadataRow {
	stream_id: string;
	channel_id: string | null;
	owner_id: string;
	kind: string;
	premiere_video_id: string | null;
	event_type: string | null;
	status: string;
	visibility: string;
	scheduled_start_at: number | null;
	started_at: number | null;
	ended_at: number | null;
	reminder_count: number;
	created_at: number;
}

interface StoredLiveStream {
	id?: string;
	channelId?: string;
	userId?: string;
	title?: string;
	description?: string;
	thumbnailUrl?: string;
	status?: 'scheduled' | 'live' | 'ended' | 'cancelled';
	scheduledStartTime?: string;
	actualStartTime?: string;
	actualEndTime?: string;
	dateCreated?: string;
	isPrivate?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
	kind?: string;
	eventType?: string | null;
	premiereVideoId?: string | null;
	reminderCount?: number;
}

interface StoredChannel {
	id?: string;
	userId?: string;
	name?: string;
	nameAr?: string | null;
	handle?: string | null;
	avatarUrl?: string | null;
	isPrivate?: boolean;
	isHidden?: boolean;
	isDeleted?: boolean;
}

function encodeOffsetCursor(offset: number): string {
	return `ev:${offset}`;
}

function decodeOffsetCursor(cursor: string | null | undefined): number {
	if (!cursor || !cursor.startsWith('ev:')) return 0;
	const n = Number(cursor.slice(3));
	return Number.isInteger(n) && n >= 0 && n <= 1_000 ? n : 0;
}

function isMissingTableError(error: unknown): boolean {
	const msg = error instanceof Error ? error.message : String(error);
	return /no such table/i.test(msg);
}

/** Indexed lookup of up to 90 channels the viewer subscribes to (NOTIFICATIONS_DB). */
async function loadViewerSubscribedChannels(ndb: D1Database | undefined, viewerId: string): Promise<string[]> {
	if (!ndb) return [];
	const ids = new Set<string>();
	const [subRes, bellRes] = await Promise.all([
		ndb
			.prepare('SELECT channel_id FROM channel_subscriptions WHERE user_id = ? ORDER BY created_at DESC LIMIT 90')
			.bind(viewerId)
			.all<{ channel_id: string }>()
			.catch(() => ({ results: [] as Array<{ channel_id: string }> })),
		ndb
			.prepare('SELECT channel_id FROM channel_subscribers WHERE user_id = ? LIMIT 90')
			.bind(viewerId)
			.all<{ channel_id: string }>()
			.catch(() => ({ results: [] as Array<{ channel_id: string }> })),
	]);
	for (const r of subRes.results ?? []) if (r.channel_id) ids.add(r.channel_id);
	for (const r of bellRes.results ?? []) if (r.channel_id) ids.add(r.channel_id);
	return [...ids].slice(0, 90);
}

/** Indexed batch lookup of which streams the viewer has set a reminder on (`live_reminders`). */
async function loadViewerReminders(
	ndb: D1Database | undefined,
	viewerId: string | null | undefined,
	streamIds: string[],
): Promise<Set<string>> {
	const reminded = new Set<string>();
	if (!ndb || !viewerId || streamIds.length === 0) return reminded;
	const batch = streamIds.slice(0, 90);
	try {
		const { results } = await ndb
			.prepare(`SELECT stream_id FROM live_reminders WHERE user_id = ? AND stream_id IN (${batch.map(() => '?').join(', ')})`)
			.bind(viewerId, ...batch)
			.all<{ stream_id: string }>();
		for (const r of results ?? []) reminded.add(r.stream_id);
	} catch (error) {
		if (!isMissingTableError(error)) {
			logger.warn('[EventCalendar] live_reminders read failed', { error: error instanceof Error ? error.message : String(error) });
		}
	}
	return reminded;
}

async function queryMetadataRows(
	db: D1Database,
	options: {
		channelIds: string[] | null;
		eventType: LiveEventType | null;
		kind: LiveStreamKind | null;
		fromMs: number | null;
		toMs: number | null;
		limit: number;
		offset: number;
	},
): Promise<LiveStreamMetadataRow[] | 'missing_table'> {
	if (options.channelIds && options.channelIds.length === 0) return [];
	const where: string[] = [];
	const params: unknown[] = [];

	if (options.channelIds && options.channelIds.length === 1) {
		// Hits idx_live_stream_meta_channel_status (channel_id, status, scheduled_start_at)
		where.push('channel_id = ?', "status IN ('live', 'scheduled')", "visibility = 'public'", 'recording_withheld = 0', 'purge_pending = 0');
		params.push(options.channelIds[0]);
	} else if (options.eventType) {
		// Hits idx_live_stream_meta_event_status (event_type, status, scheduled_start_at)
		where.push('event_type = ?', "status IN ('live', 'scheduled')", "visibility = 'public'", 'recording_withheld = 0', 'purge_pending = 0');
		params.push(options.eventType);
		if (options.channelIds) {
			where.push(`channel_id IN (${options.channelIds.map(() => '?').join(', ')})`);
			params.push(...options.channelIds);
		}
	} else {
		// Hits idx_live_stream_meta_status_sched (status, scheduled_start_at)
		where.push("status IN ('live', 'scheduled')", "visibility = 'public'", 'recording_withheld = 0', 'purge_pending = 0');
		if (options.channelIds) {
			where.push(`channel_id IN (${options.channelIds.map(() => '?').join(', ')})`);
			params.push(...options.channelIds);
		}
	}

	if (options.kind) {
		where.push('kind = ?');
		params.push(options.kind);
	}
	if (options.fromMs !== null) {
		where.push("(status = 'live' OR scheduled_start_at IS NULL OR scheduled_start_at >= ?)");
		params.push(options.fromMs);
	}
	if (options.toMs !== null) {
		where.push('(scheduled_start_at IS NULL OR scheduled_start_at <= ?)');
		params.push(options.toMs);
	}

	try {
		const { results } = await db
			.prepare(
				`SELECT stream_id, channel_id, owner_id, kind, premiere_video_id, event_type, status, visibility, scheduled_start_at, started_at, ended_at, reminder_count, created_at
				 FROM live_stream_metadata
				 WHERE ${where.join(' AND ')}
				 ORDER BY CASE WHEN status = 'live' THEN 0 ELSE 1 END ASC, COALESCE(scheduled_start_at, created_at) ASC, stream_id ASC
				 LIMIT ? OFFSET ?`,
			)
			.bind(...params, options.limit, options.offset)
			.all<LiveStreamMetadataRow>();
		return results ?? [];
	} catch (error) {
		if (isMissingTableError(error)) return 'missing_table';
		throw error;
	}
}

export async function listCalendarEvents(
	env: EventCalendarEnv,
	options: ListCalendarEventsOptions = {},
): Promise<{ items: CalendarEventItem[]; nextCursor: string | null }> {
	const limit = Math.min(Math.max(1, Math.floor(options.limit ?? 24)), EVENT_CALENDAR_PAGE_MAX);
	const initialOffset = decodeOffsetCursor(options.cursor);
	const viewerId = options.viewerId ?? null;
	const nowMs = options.nowMs ?? Date.now();
	const effectiveFromMs = options.fromMs === undefined ? nowMs - PAST_SCHEDULED_GRACE_MS : options.fromMs;

	let channelFilter: string[] | null = options.channelId ? [options.channelId] : null;
	if (options.subscribedOnly) {
		if (!viewerId) return { items: [], nextCursor: null };
		const subIds = await loadViewerSubscribedChannels(env.NOTIFICATIONS_DB, viewerId);
		if (options.channelId) {
			channelFilter = subIds.includes(options.channelId) ? [options.channelId] : [];
		} else {
			channelFilter = subIds;
		}
		if (channelFilter.length === 0) return { items: [], nextCursor: null };
	}

	if (!env.SEARCH_DB) return { items: [], nextCursor: null };

	const streamRepo = new NonVideoRepository<StoredLiveStream>(env.videos);
	const channelRepo = new R2Repository<StoredChannel>(env.channels);
	const channelCache = new Map<string, StoredChannel | null>();
	const loadChannel = async (id: string): Promise<StoredChannel | null> => {
		if (channelCache.has(id)) return channelCache.get(id)!;
		const ch = await channelRepo.getObject(id).catch(() => null);
		channelCache.set(id, ch);
		return ch;
	};

	const fetchLimit = limit + 10;
	const visible: CalendarEventItem[] = [];
	let currentOffset = initialOffset;
	let hasMore = false;
	let usedFallback = false;

	for (let scanPage = 0; scanPage < MAX_SCAN_PAGES; scanPage++) {
		let candidates: Array<{ id: string; meta: LiveStreamMetadataRow | null }> = [];
		const metaRows = usedFallback
			? 'missing_table'
			: await queryMetadataRows(env.SEARCH_DB, {
					channelIds: channelFilter,
					eventType: options.eventType ?? null,
					kind: options.kind ?? null,
					fromMs: effectiveFromMs,
					toMs: options.toMs ?? null,
					limit: fetchLimit,
					offset: currentOffset,
				});
		if (metaRows !== 'missing_table') {
			candidates = metaRows.map((m) => ({ id: m.stream_id, meta: m }));
		} else {
			usedFallback = true;
			// Fallback before E17-1's live_stream_metadata migration lands: indexed content_ownership (kind = 'stream')
			const where = ["kind = 'stream'", 'is_deleted = 0', 'is_hidden = 0', 'is_public = 1', "status IN ('live', 'scheduled')"];
			const params: unknown[] = [];
			if (channelFilter && channelFilter.length === 1) {
				where.push('channel_id = ?');
				params.push(channelFilter[0]);
			} else if (channelFilter && channelFilter.length > 1) {
				where.push(`channel_id IN (${channelFilter.map(() => '?').join(', ')})`);
				params.push(...channelFilter);
			}
			const { results } = await env.SEARCH_DB
				.prepare(`SELECT id FROM content_ownership WHERE ${where.join(' AND ')} ORDER BY created_at DESC, id ASC LIMIT ? OFFSET ?`)
				.bind(...params, fetchLimit, currentOffset)
				.all<{ id: string }>();
			candidates = (results ?? []).map((r) => ({ id: r.id, meta: null }));
		}

		if (candidates.length === 0) {
			hasMore = false;
			break;
		}

		const streams = await Promise.all(
			candidates.map(async ({ id, meta }) => ({
				id,
				meta,
				stream: await streamRepo.getObject(`livestream:${id}`).catch(() => null),
			})),
		);

		let brokeWithExtra = false;
		for (let idx = 0; idx < streams.length; idx++) {
			const { id, meta, stream } = streams[idx]!;
			if ((meta && meta.visibility !== 'public') || !stream || stream.isPrivate || stream.isHidden || stream.isDeleted) {
				currentOffset++;
				continue;
			}
			const status = (meta?.status ?? stream.status ?? 'scheduled') as CalendarEventItem['status'];
			if (status !== 'live' && status !== 'scheduled') {
				currentOffset++;
				continue;
			}

			const channelId = meta?.channel_id ?? stream.channelId ?? '';
			if (!channelId || (channelFilter && !channelFilter.includes(channelId))) {
				currentOffset++;
				continue;
			}

			const channel = await loadChannel(channelId);
			if (!channel || channel.isDeleted || channel.isHidden || channel.isPrivate) {
				currentOffset++;
				continue;
			}

			const kind: LiveStreamKind = isLiveStreamKind(meta?.kind ?? stream.kind) ? ((meta?.kind ?? stream.kind) as LiveStreamKind) : 'live';
			if (options.kind && kind !== options.kind) {
				currentOffset++;
				continue;
			}

			const rawEventType = meta?.event_type ?? stream.eventType ?? null;
			const eventType: LiveEventType | null = isLiveEventType(rawEventType) ? rawEventType : null;
			if (options.eventType && eventType !== options.eventType) {
				currentOffset++;
				continue;
			}

			const scheduledMs =
				meta?.scheduled_start_at ??
				(stream.scheduledStartTime ? new Date(stream.scheduledStartTime).getTime() : NaN);
			const scheduledStartAt = Number.isFinite(scheduledMs) ? new Date(scheduledMs).toISOString() : null;

			if (status !== 'live') {
				if (effectiveFromMs !== null && Number.isFinite(scheduledMs) && scheduledMs < effectiveFromMs) {
					currentOffset++;
					continue;
				}
				if (options.toMs !== null && options.toMs !== undefined && Number.isFinite(scheduledMs) && scheduledMs > options.toMs) {
					currentOffset++;
					continue;
				}
			}

			if (visible.length >= limit) {
				// Leave currentOffset pointing at this unconsumed visible item for the next page
				hasMore = true;
				brokeWithExtra = true;
				break;
			}
			currentOffset++;

			const startedAt = meta?.started_at
				? new Date(meta.started_at).toISOString()
				: stream.actualStartTime ?? null;
			const endedAt = meta?.ended_at
				? new Date(meta.ended_at).toISOString()
				: stream.actualEndTime ?? null;
			const premiereVideoId = meta?.premiere_video_id ?? stream.premiereVideoId ?? null;
			// Premieres also open on /live/<streamId>; /video/<id> returns 404 before a premiere starts (E17).
			const watchPath = `/live/${encodeURIComponent(id)}`;

			visible.push({
				streamId: id,
				channelId,
				channelName: channel.name || '',
				channelNameAr: channel.nameAr ?? null,
				channelHandle: channel.handle ?? null,
				channelAvatarUrl: channel.avatarUrl ?? null,
				title: stream.title || '',
				description: stream.description ?? null,
				thumbnailUrl: stream.thumbnailUrl ?? null,
				kind,
				eventType,
				status,
				scheduledStartAt,
				startedAt,
				endedAt,
				premiereVideoId,
				reminderCount: Number(meta?.reminder_count ?? stream.reminderCount ?? 0) || 0,
				viewerReminded: false,
				watchPath,
			});
		}

		if (brokeWithExtra) break;
		if (candidates.length < fetchLimit) {
			hasMore = false;
			break;
		}
		if (visible.length >= limit) {
			hasMore = true;
			break;
		}
	}

	if (usedFallback) {
		visible.sort((a, b) => {
			if (a.status === 'live' && b.status !== 'live') return -1;
			if (b.status === 'live' && a.status !== 'live') return 1;
			const ta = a.scheduledStartAt ? new Date(a.scheduledStartAt).getTime() : Number.MAX_SAFE_INTEGER;
			const tb = b.scheduledStartAt ? new Date(b.scheduledStartAt).getTime() : Number.MAX_SAFE_INTEGER;
			return ta - tb || a.streamId.localeCompare(b.streamId);
		});
	}

	const reminded = await loadViewerReminders(env.NOTIFICATIONS_DB, viewerId, visible.map((item) => item.streamId));
	for (const item of visible) {
		item.viewerReminded = reminded.has(item.streamId);
	}

	return {
		items: visible,
		nextCursor: hasMore && visible.length > 0 ? encodeOffsetCursor(currentOffset) : null,
	};
}
