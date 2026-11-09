/**
 * Channel subscriptions in D1 (NOTIFICATIONS_DB, migration 0006;
 * docs/architecture/SCALABILITY-AUDIT.md, AV-4 and AV-6).
 *
 * The source of truth for who subscribes to which channel. It replaces the
 * `subscriptions[]` array in each channel JSON and the `subscribedTo[]`
 * reverse index in each profile, which concurrent subscribers overwrote.
 *
 * Every change is one D1 batch (a transaction): the row insert/delete, the
 * subscriber count (+1/-1 only when the row really changed, via `changes()`)
 * and the notification bell row (channel_subscribers) move together, so any
 * number of concurrent subscribers add up exactly.
 *
 * Legacy data: a channel's R2 array is copied in once, with a marker row in
 * the same transaction (importLegacySubscriptions). Writes import the channel
 * first; the daily cron imports the rest. Readers use D1 for imported
 * channels and the R2 array for the others, so nothing is lost or counted
 * twice during the move.
 */
import { DEFAULT_CHANNEL_BELL } from '@al-ummah/shared-types';
import R2Repository from './r2Repo';

export interface LegacySubscription {
	id?: string;
	userId?: string;
	channelId?: string;
	dateCreated?: string;
}

/** The parts of a channel JSON this module reads. */
export interface ChannelWithLegacySubscriptions {
	id?: string;
	subscriptions?: LegacySubscription[] | null;
}

export interface SubscriptionChange {
	/** True when this call added/removed the subscription (false: already so). */
	changed: boolean;
	subscribers: number;
	/** Subscription id (the new one, or the removed one). */
	subscriptionId: string | null;
}

/** Legacy entries as JSON rows for a bulk insert: one statement, one parameter. */
function legacyRows(subscriptions: LegacySubscription[] | null | undefined, now: number) {
	const seen = new Set<string>();
	const rows: { c: string; u: string; i: string; t: number }[] = [];
	for (const s of subscriptions || []) {
		if (!s?.channelId || seen.has(s.channelId)) continue;
		seen.add(s.channelId);
		const created = s.dateCreated ? Date.parse(s.dateCreated) : NaN;
		rows.push({ c: s.channelId, u: s.userId || '', i: s.id || crypto.randomUUID(), t: Number.isFinite(created) ? created : now });
	}
	return rows;
}

/**
 * Copies a channel's legacy R2 `subscriptions[]` into D1, once. Every
 * statement is guarded by "no marker yet" and the batch is one transaction,
 * so concurrent imports (or an import racing a write) cannot double count:
 * the count is recomputed from the rows inside the transaction.
 * Resolves to true when this call imported the channel, false when it was
 * imported already (or has no id).
 */
export async function importLegacySubscriptions(db: D1Database, channel: ChannelWithLegacySubscriptions, now = Date.now()): Promise<boolean> {
	const channelId = channel.id;
	if (!channelId) return false;
	const marker = await db.prepare('SELECT 1 AS imported FROM channel_subscription_imports WHERE channel_id = ?').bind(channelId).first();
	if (marker) return false;
	const rows = legacyRows(channel.subscriptions, now);
	const json = JSON.stringify(rows);
	const notImported = 'NOT EXISTS (SELECT 1 FROM channel_subscription_imports WHERE channel_id = ?1)';
	const results = await db.batch([
		db
			.prepare(
				`INSERT OR IGNORE INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at)
				 SELECT ?1, json_extract(j.value, '$.c'), json_extract(j.value, '$.u'), json_extract(j.value, '$.i'), json_extract(j.value, '$.t')
				 FROM json_each(?2) AS j WHERE ${notImported}`,
			)
			.bind(channelId, json),
		db
			.prepare(
				`INSERT INTO channel_subscriber_counts (channel_id, subscribers)
				 SELECT ?1, (SELECT COUNT(*) FROM channel_subscriptions WHERE channel_id = ?1) WHERE ${notImported}
				 ON CONFLICT (channel_id) DO UPDATE SET subscribers = excluded.subscribers`,
			)
			.bind(channelId),
		// Bell rows for notification fan-out (kept if they exist)
		db
			.prepare(
				`INSERT OR IGNORE INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at)
				 SELECT ?1, json_extract(j.value, '$.u'), ?3, json_extract(j.value, '$.t'), json_extract(j.value, '$.t')
				 FROM json_each(?2) AS j WHERE json_extract(j.value, '$.u') != '' AND ${notImported}`,
			)
			.bind(channelId, json, DEFAULT_CHANNEL_BELL),
		db
			.prepare('INSERT OR IGNORE INTO channel_subscription_imports (channel_id, legacy_count, imported_at) VALUES (?1, ?2, ?3)')
			.bind(channelId, rows.length, now),
	]);
	return Number(results[3]?.meta?.changes ?? 0) === 1;
}

function countFrom(result: D1Result | undefined): number {
	const row = (result?.results?.[0] ?? null) as { subscribers?: number } | null;
	return Math.max(0, Number(row?.subscribers ?? 0));
}

/**
 * Subscribes `subscriberChannelId` (owned by `userId`) to `channel`.
 * Idempotent: subscribing again changes nothing.
 */
export async function subscribe(
	db: D1Database,
	channel: ChannelWithLegacySubscriptions,
	subscriber: { userId: string; channelId: string },
	now = Date.now(),
): Promise<SubscriptionChange> {
	const channelId = channel.id!;
	await importLegacySubscriptions(db, channel, now);
	const id = crypto.randomUUID();
	const results = await db.batch([
		db
			.prepare('INSERT OR IGNORE INTO channel_subscriptions (channel_id, subscriber_channel_id, user_id, id, created_at) VALUES (?1, ?2, ?3, ?4, ?5)')
			.bind(channelId, subscriber.channelId, subscriber.userId, id, now),
		// changes() is the previous statement's: +1 only when the row was inserted
		db
			.prepare(
				`INSERT INTO channel_subscriber_counts (channel_id, subscribers) SELECT ?1, 1 WHERE changes() = 1
				 ON CONFLICT (channel_id) DO UPDATE SET subscribers = subscribers + 1`,
			)
			.bind(channelId),
		db
			.prepare('INSERT OR IGNORE INTO channel_subscribers (channel_id, user_id, bell, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?4)')
			.bind(channelId, subscriber.userId, DEFAULT_CHANNEL_BELL, now),
		db.prepare('SELECT subscribers FROM channel_subscriber_counts WHERE channel_id = ?1').bind(channelId),
	]);
	const changed = Number(results[0]?.meta?.changes ?? 0) === 1;
	return { changed, subscribers: countFrom(results[3]), subscriptionId: changed ? id : null };
}

/**
 * Removes the subscription of `subscriberChannelId` (owned by `userId`) from
 * `channel`. The bell row goes too once the user has no other subscribing
 * channel. Idempotent.
 */
export async function unsubscribe(
	db: D1Database,
	channel: ChannelWithLegacySubscriptions,
	subscriber: { userId: string; channelId: string },
	now = Date.now(),
): Promise<SubscriptionChange> {
	const channelId = channel.id!;
	await importLegacySubscriptions(db, channel, now);
	const results = await db.batch([
		db
			.prepare('DELETE FROM channel_subscriptions WHERE channel_id = ?1 AND subscriber_channel_id = ?2 AND user_id = ?3 RETURNING id')
			.bind(channelId, subscriber.channelId, subscriber.userId),
		// changes() is the previous statement's: -1 only when the row was deleted
		db.prepare('UPDATE channel_subscriber_counts SET subscribers = MAX(subscribers - changes(), 0) WHERE channel_id = ?1').bind(channelId),
		db
			.prepare(
				`DELETE FROM channel_subscribers WHERE channel_id = ?1 AND user_id = ?2
				 AND NOT EXISTS (SELECT 1 FROM channel_subscriptions WHERE channel_id = ?1 AND user_id = ?2)`,
			)
			.bind(channelId, subscriber.userId),
		db.prepare('SELECT subscribers FROM channel_subscriber_counts WHERE channel_id = ?1').bind(channelId),
	]);
	const removed = (results[0]?.results?.[0] ?? null) as { id?: string } | null;
	return { changed: !!removed, subscribers: countFrom(results[3]), subscriptionId: removed?.id ?? null };
}

export interface SubscriptionState {
	imported: boolean;
	subscribers: number;
}

/**
 * Subscriber counts of many channels in one query. Channels not imported yet
 * are counted from their legacy R2 array (distinct subscriber channels).
 */
export async function subscriberCounts(
	db: D1Database | undefined,
	channels: ChannelWithLegacySubscriptions[],
): Promise<Map<string, number>> {
	const counts = new Map<string, number>();
	const ids = [...new Set(channels.map((c) => c?.id).filter((id): id is string => !!id))];
	const legacy = (c: ChannelWithLegacySubscriptions) => legacyRows(c.subscriptions, 0).length;
	if (!db || ids.length === 0) {
		for (const c of channels) if (c?.id) counts.set(c.id, legacy(c));
		return counts;
	}
	const { results } = await db
		.prepare(
			`SELECT j.value AS channel_id, i.channel_id IS NOT NULL AS imported, n.subscribers AS subscribers
			 FROM json_each(?1) AS j
			 LEFT JOIN channel_subscription_imports i ON i.channel_id = j.value
			 LEFT JOIN channel_subscriber_counts n ON n.channel_id = j.value`,
		)
		.bind(JSON.stringify(ids))
		.all<{ channel_id: string; imported: number; subscribers: number | null }>();
	const state = new Map((results || []).map((r) => [r.channel_id, r]));
	for (const c of channels) {
		if (!c?.id) continue;
		const row = state.get(c.id);
		counts.set(c.id, row && row.imported ? Math.max(0, Number(row.subscribers ?? 0)) : legacy(c));
	}
	return counts;
}

/**
 * Whether the viewer is subscribed to `channel`: as `viewer.channelId` when
 * given, otherwise as any of their channels (like the legacy isSubscribed).
 */
export async function isSubscribedTo(
	db: D1Database | undefined,
	channel: ChannelWithLegacySubscriptions,
	viewer: { userId: string; channelId?: string | null },
): Promise<boolean> {
	const channelId = channel.id;
	if (!channelId) return false;
	const legacy = () => {
		const subs = channel.subscriptions || [];
		return viewer.channelId ? subs.some((s) => s.channelId === viewer.channelId) : subs.some((s) => s.userId === viewer.userId);
	};
	if (!db) return legacy();
	const row = await db
		.prepare(
			`SELECT EXISTS (SELECT 1 FROM channel_subscription_imports WHERE channel_id = ?1) AS imported,
			        EXISTS (SELECT 1 FROM channel_subscriptions WHERE channel_id = ?1
			                AND (CASE WHEN ?2 IS NOT NULL THEN subscriber_channel_id = ?2 ELSE user_id = ?3 END)) AS subscribed`,
		)
		.bind(channelId, viewer.channelId ?? null, viewer.userId)
		.first<{ imported: number; subscribed: number }>();
	if (!row?.imported) return legacy();
	return row.subscribed === 1;
}

/**
 * Channels the user subscribes to (as any of their channels), oldest first:
 * D1 rows, plus the legacy profile `subscribedTo[]` entries of channels that
 * are not imported yet (for those, R2 is still the truth).
 */
export async function subscribedChannelIds(
	db: D1Database | undefined,
	userId: string,
	legacySubscribedTo: string[] | null | undefined,
): Promise<string[]> {
	const legacy = [...new Set((legacySubscribedTo || []).filter((id) => typeof id === 'string' && id))];
	if (!db) return legacy;
	const [mine, pending] = await db.batch([
		db.prepare('SELECT channel_id FROM channel_subscriptions WHERE user_id = ?1 GROUP BY channel_id ORDER BY MIN(created_at), channel_id').bind(userId),
		db
			.prepare('SELECT j.value AS channel_id FROM json_each(?1) AS j WHERE NOT EXISTS (SELECT 1 FROM channel_subscription_imports i WHERE i.channel_id = j.value) ORDER BY j.key')
			.bind(JSON.stringify(legacy)),
	]);
	const ids: string[] = [];
	const seen = new Set<string>();
	for (const row of [...((pending?.results || []) as { channel_id: string }[]), ...((mine?.results || []) as { channel_id: string }[])]) {
		if (seen.has(row.channel_id)) continue;
		seen.add(row.channel_id);
		ids.push(row.channel_id);
	}
	return ids;
}

/**
 * Adds or removes a subscription: in D1 when NOTIFICATIONS_DB is bound,
 * otherwise (local dev, a preview without the database) in the channel's
 * legacy array and the profile's `subscribedTo[]` with conditional writes,
 * which the import later copies.
 * Resolves to null when the channel does not exist.
 */
export async function changeSubscription(
	env: { NOTIFICATIONS_DB?: D1Database; channels: R2Bucket; profiles?: R2Bucket },
	channel: ChannelWithLegacySubscriptions,
	subscriber: { userId: string; channelId: string },
	action: 'add' | 'remove',
): Promise<SubscriptionChange | null> {
	if (env.NOTIFICATIONS_DB) {
		return action === 'add'
			? subscribe(env.NOTIFICATIONS_DB, channel, subscriber)
			: unsubscribe(env.NOTIFICATIONS_DB, channel, subscriber);
	}
	let subscriptionId: string | null = null;
	const stored = await new R2Repository<ChannelWithLegacySubscriptions>(env.channels).updateObject(channel.id!, (fresh) => {
		subscriptionId = null;
		const list = fresh.subscriptions || [];
		const mine = list.find((s) => s.channelId === subscriber.channelId);
		if (action === 'add') {
			if (mine) return false;
			subscriptionId = crypto.randomUUID();
			fresh.subscriptions = [...list, { id: subscriptionId, userId: subscriber.userId, channelId: subscriber.channelId, dateCreated: new Date().toISOString() }];
			return true;
		}
		if (!mine || (mine.userId && mine.userId !== subscriber.userId)) return false;
		subscriptionId = mine.id ?? null;
		fresh.subscriptions = list.filter((s) => s !== mine);
		return true;
	});
	if (!stored) return null;
	if (subscriptionId !== null && env.profiles) {
		await new R2Repository<{ subscribedTo?: string[] }>(env.profiles).updateObject(subscriber.userId, (profile) => {
			const list = profile.subscribedTo || [];
			if (action === 'add') {
				if (list.includes(channel.id!)) return false;
				profile.subscribedTo = [...list, channel.id!];
				return true;
			}
			if (!list.includes(channel.id!)) return false;
			profile.subscribedTo = list.filter((id) => id !== channel.id);
			return true;
		});
	}
	return { changed: subscriptionId !== null, subscribers: legacyRows(stored.subscriptions, 0).length, subscriptionId };
}

/**
 * The user's subscriptions stored in D1, for the privacy export (GDPR Art. 15/20).
 * Legacy entries still in R2 arrays are exported by the channel scan.
 */
export async function exportUserSubscriptions(db: D1Database, userId: string): Promise<Array<Record<string, unknown>>> {
	const { results } = await db
		.prepare('SELECT channel_id, subscriber_channel_id, id, created_at FROM channel_subscriptions WHERE user_id = ?1 ORDER BY created_at')
		.bind(userId)
		.all<{ channel_id: string; subscriber_channel_id: string; id: string; created_at: number }>();
	return (results ?? []).map((row) => ({
		id: row.id,
		userId,
		channelId: row.subscriber_channel_id,
		subscribedToChannelId: row.channel_id,
		dateCreated: new Date(row.created_at).toISOString(),
		source: 'd1',
	}));
}

/**
 * Erases the user's D1 subscriptions and takes them off the counts, in one
 * transaction. Each decrement is derived from the rows still present, so this
 * and the processor's eraseUserNotifications (same statements) can both run
 * without counting anything twice. Returns the number of rows deleted.
 */
export async function eraseUserSubscriptions(db: D1Database, userId: string): Promise<number> {
	const [, , removed] = await db.batch([
		db
			.prepare(
				`UPDATE channel_subscriber_counts
				 SET subscribers = MAX(subscribers - (SELECT COUNT(*) FROM channel_subscriptions s WHERE s.channel_id = channel_subscriber_counts.channel_id AND s.user_id = ?1), 0)
				 WHERE channel_id IN (SELECT channel_id FROM channel_subscriptions WHERE user_id = ?1)`,
			)
			.bind(userId),
		db.prepare('DELETE FROM channel_subscriptions WHERE user_id = ?1').bind(userId),
		db.prepare('SELECT changes() AS n'),
	]);
	return Number((removed.results?.[0] as { n?: number } | undefined)?.n ?? 0);
}
