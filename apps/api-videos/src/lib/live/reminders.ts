/**
 * Reminders (wiki E17 §5.5): who asked to hear of a stream or premiere (NOTIFICATIONS_DB.live_reminders)
 * and the heads-up 15 minutes before. Sending is the processor's fan-out: notification settings, quiet
 * hours and the one-per-person dedupe are its. The start itself is announced with the channel's bell.
 */
import { LIVE_METADATA_TABLE, featureGate } from '@al-ummah/shared-types';
import { logger } from '../logger';
import { channelNameParamsOf } from '../notification-events';
import { enqueueFanout } from '../notifications';
import { cancelPremiere, premiereStillPossible, isPremiere, type PremiereEnv } from './premieres';
import { readStream } from './streams';

export const HEADS_UP_MS = 15 * 60_000;

interface Row {
	kind: string;
	channel_id: string | null;
	status: string;
	visibility: string;
	made_for_kids: number;
	reminder_count: number;
}

const changes = (r: unknown) => Number((r as { meta?: { changes?: number } } | null)?.meta?.changes) || 0;

/** Premieres are on; off while the switch cannot be read. */
const premieresOn = async (env: object) => (await featureGate(env as never, 'livePremieres').catch(() => ({ on: false as const }))).on;

/** What a reminder can be set on: a public, scheduled stream of a channel, not made for kids; a premiere only while premieres are on. */
export async function remindable(env: { SEARCH_DB?: D1Database }, streamId: string): Promise<{ count: number } | null> {
	if (!env.SEARCH_DB) return null;
	const row = await env.SEARCH_DB.prepare(`SELECT kind, channel_id, status, visibility, made_for_kids, reminder_count FROM ${LIVE_METADATA_TABLE} WHERE stream_id = ?`).bind(streamId).first<Row>();
	if (!row || row.status !== 'scheduled' || row.visibility !== 'public' || row.made_for_kids !== 0 || !row.channel_id) return null;
	if (row.kind === 'premiere' && !(await premieresOn(env))) return null;
	return { count: row.reminder_count };
}

async function adjust(db: D1Database, streamId: string, by: 1 | -1): Promise<number> {
	const row = await db.prepare(`UPDATE ${LIVE_METADATA_TABLE} SET reminder_count = MAX(0, reminder_count + ?) WHERE stream_id = ? RETURNING reminder_count`).bind(by, streamId).first<{ reminder_count: number }>();
	return row?.reminder_count ?? 0;
}

/** Sets (or takes back) the person's reminder; the count moves only when a row did. */
export async function setReminder(db: D1Database, ndb: D1Database, streamId: string, userId: string, on: boolean, count: number, now = Date.now()): Promise<number> {
	const result = on
		? await ndb.prepare('INSERT OR IGNORE INTO live_reminders (stream_id, user_id, created_at) VALUES (?, ?, ?)').bind(streamId, userId, now).run()
		: await ndb.prepare('DELETE FROM live_reminders WHERE stream_id = ? AND user_id = ?').bind(streamId, userId).run();
	return changes(result) > 0 ? adjust(db, streamId, on ? 1 : -1) : count;
}

export async function hasReminder(ndb: D1Database | undefined, streamId: string, userId: string | undefined): Promise<boolean> {
	if (!ndb || !userId) return false;
	return !!(await ndb.prepare('SELECT 1 AS x FROM live_reminders WHERE stream_id = ? AND user_id = ?').bind(streamId, userId).first());
}

type HeadsUpEnv = PremiereEnv & { NOTIFICATIONS_DB?: D1Database };

/**
 * Every minute: streams starting within 15 minutes are announced to those who asked. Each is claimed for
 * its start time, so it is announced once, and again when it is moved. A premiere that can no longer be
 * shown is cancelled instead.
 */
export async function runHeadsUps(env: HeadsUpEnv, now = Date.now()): Promise<{ sent: number; cancelled: number; failed: number }> {
	const out = { sent: 0, cancelled: 0, failed: 0 };
	const { SEARCH_DB: db, NOTIFICATIONS_DB: ndb } = env;
	if (!db || !ndb || !(await featureGate(env as never, 'liveReminders')).on) return out;
	const { results } = await db
		.prepare(
			`SELECT stream_id, scheduled_start_at, heads_up_for FROM ${LIVE_METADATA_TABLE}
			 WHERE status = 'scheduled' AND scheduled_start_at > ? AND scheduled_start_at <= ?
			   AND visibility = 'public' AND made_for_kids = 0 AND channel_id IS NOT NULL AND heads_up_for IS NOT scheduled_start_at
			 ORDER BY scheduled_start_at LIMIT 100`,
		)
		.bind(now, now + HEADS_UP_MS)
		.all<{ stream_id: string; scheduled_start_at: number; heads_up_for: number | null }>();
	for (const { stream_id: id, scheduled_start_at: startsAt, heads_up_for: before } of results ?? []) {
		try {
			const stream = await readStream(env as never, id);
			// It will not start while premieres are off; the claim is left for when they are on again
			if (isPremiere(stream) && !(await premieresOn(env))) continue;
			if (isPremiere(stream) && !(await premiereStillPossible(env, stream))) {
				if ((await cancelPremiere(env, id, 'video_unavailable', now)).outcome === 'cancelled') out.cancelled++;
				continue;
			}
			if (!stream?.channelId) continue;
			// The count as it really is, while we are here
			const people = Number((await ndb.prepare('SELECT COUNT(*) AS n FROM live_reminders WHERE stream_id = ?').bind(id).first<{ n: number }>())?.n) || 0;
			await db.prepare(`UPDATE ${LIVE_METADATA_TABLE} SET reminder_count = ? WHERE stream_id = ? AND reminder_count != ?`).bind(people, id, people).run();
			const params = { ...(await channelNameParamsOf(env as never, stream.channelId)), streamTitle: stream.title || '' };
			// Claimed only now that everything is read: what can still fail is the queue, and that gives the claim back
			const claimed = await db.prepare(`UPDATE ${LIVE_METADATA_TABLE} SET heads_up_for = ?1 WHERE stream_id = ?2 AND status = 'scheduled' AND scheduled_start_at = ?1 AND heads_up_for IS NOT ?1`).bind(startsAt, id).run();
			if (changes(claimed) === 0 || people === 0) continue;
			const queued = await enqueueFanout(env as never, {
				kind: 'live_soon',
				audience: 'reminders',
				channelId: stream.channelId,
				entityId: id,
				startsAt,
				isHighlight: true,
				params,
				actionUrl: `/live/${id}`,
				actorUserId: stream.userId,
			});
			if (queued) out.sent++;
			else {
				// Not queued: the next minute tries again
				await db.prepare(`UPDATE ${LIVE_METADATA_TABLE} SET heads_up_for = ? WHERE stream_id = ? AND heads_up_for = ?`).bind(before, id, startsAt).run();
				out.failed++;
			}
		} catch (error) {
			out.failed++;
			logger.error('[LiveReminders] Heads-up failed', { streamId: id, error: error instanceof Error ? error.message : String(error) });
		}
	}
	return out;
}
