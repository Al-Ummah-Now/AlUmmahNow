/**
 * Per-post view counter (docs/architecture/SCALABILITY-AUDIT.md, AV-17).
 *
 * Community post views are daily counters in D1 (NOTIFICATIONS_DB,
 * `analytics_daily`, entity_type 'post', metric 'views'). api-videos used to
 * upsert one row per GET of a post, so a busy post wrote the same D1 row on
 * every view, and D1 serialises all writes to one database.
 *
 * Now each view goes to one Durable Object shard, named
 * `postviews:<postId>:<shard>`. A shard is the single writer of its own
 * per-day totals and flushes them at most once per FLUSH_DELAY_MS, one row
 * per shard and day:
 *
 *   (entity_type 'post', entity_id <postId>, day, metric 'views', dim 'counter:<shard>')
 *   value = max(stored, this shard's cumulative total for that day)
 *
 * The max-merge makes a flush idempotent: a flush retried after D1 committed
 * but before this object recorded it can never count twice. Readers sum every
 * dim of metric 'views', so these rows add to the direct rows (dim '') that
 * api-videos still writes when this object cannot be reached.
 */

/** Wait after the first unflushed view, so a hot post costs one D1 write per shard per window. */
export const POST_FLUSH_DELAY_MS = 10_000;
/** Back-off when D1 is unavailable. */
export const POST_RETRY_DELAY_MS = 30_000;

export const POST_STATE_KEY = 'postViewCounter';

export interface PostViewCounterState {
	postId: string;
	shard: string;
	/** UTC day (YYYY-MM-DD) → views this shard counted that day. */
	days: Record<string, number>;
	/** UTC day → the part of `days[day]` confirmed in D1. */
	flushed: Record<string, number>;
}

/** The subset of DurableObjectStorage the counter uses. */
export interface PostCounterStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	delete(key: string): Promise<boolean>;
	getAlarm(): Promise<number | null>;
	setAlarm(scheduledTime: number): Promise<void>;
}

/** The subset of D1Database the counter uses. */
export interface CounterDb {
	prepare(query: string): { bind(...values: unknown[]): unknown };
	batch(statements: unknown[]): Promise<unknown>;
}

export interface PostViewCounterLogger {
	warn(message: string, meta?: unknown): void;
	error(message: string, meta?: unknown): void;
}

export function postViewCounterName(postId: string, shard: number | string): string {
	return `postviews:${postId}:${shard}`;
}

export function postCounterDim(shard: string): string {
	return `counter:${shard}`;
}

function utcDay(ms: number): string {
	return new Date(ms).toISOString().slice(0, 10);
}

function unflushed(state: PostViewCounterState): number {
	let n = 0;
	for (const [day, total] of Object.entries(state.days)) n += Math.max(0, total - (state.flushed[day] ?? 0));
	return n;
}

const UPSERT = `INSERT INTO analytics_daily (entity_type, entity_id, day, metric, dim, value)
	VALUES ('post', ?1, ?2, 'views', ?3, ?4)
	ON CONFLICT (entity_type, entity_id, day, metric, dim) DO UPDATE SET value = max(value, excluded.value)`;

export class PostViewCounter {
	private state: PostViewCounterState | null | undefined;
	private loading?: Promise<void>;

	constructor(
		private readonly storage: PostCounterStorage,
		private readonly db: CounterDb | undefined,
		private readonly opts: { logger?: PostViewCounterLogger; now?: () => number } = {},
	) {}

	private now(): number {
		return this.opts.now ? this.opts.now() : Date.now();
	}

	/** Loads the state once, however many requests arrive while it loads (they must share one state object). */
	private async load(): Promise<PostViewCounterState | null> {
		if (this.state === undefined) {
			this.loading ??= this.storage.get<PostViewCounterState>(POST_STATE_KEY).then((stored) => {
				if (this.state === undefined) this.state = stored ?? null;
			});
			await this.loading;
		}
		return this.state ?? null;
	}

	/** True when this object is a post view counter (it has counted a view). */
	async active(): Promise<boolean> {
		return (await this.load()) !== null;
	}

	/** Counts one view. Resolves once it is durable in this object's storage. */
	async increment(postId: string, shard: string): Promise<{ unflushed: number }> {
		await this.load();
		// Synchronous from here until the put: no other request can interleave
		this.state ??= { postId, shard, days: {}, flushed: {} };
		const state = this.state;
		if (state.postId !== postId || state.shard !== shard) {
			throw new Error(`post view counter: object for ${state.postId}/${state.shard} got a view for ${postId}/${shard}`);
		}
		const day = utcDay(this.now());
		state.days[day] = (state.days[day] ?? 0) + 1;
		await this.storage.put(POST_STATE_KEY, structuredClone(state));
		if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(this.now() + POST_FLUSH_DELAY_MS);
		return { unflushed: unflushed(state) };
	}

	/** Alarm handler: flush every day with unflushed views, then schedule the next flush. Never throws. */
	async alarm(): Promise<void> {
		const state = await this.load();
		if (!state) return;
		if (!this.db) {
			this.opts.logger?.error('post view counter: no NOTIFICATIONS_DB bound, cannot flush', { postId: state.postId });
			await this.storage.setAlarm(this.now() + POST_RETRY_DELAY_MS);
			return;
		}

		const targets = Object.entries(state.days).filter(([day, total]) => total > (state.flushed[day] ?? 0));
		if (targets.length > 0) {
			const dim = postCounterDim(state.shard);
			try {
				await this.db.batch(targets.map(([day, total]) => this.db!.prepare(UPSERT).bind(state.postId, day, dim, total)));
			} catch (error) {
				this.opts.logger?.warn('post view counter: flush failed, retrying', { postId: state.postId, shard: state.shard, error: String(error) });
				await this.storage.setAlarm(this.now() + POST_RETRY_DELAY_MS);
				return;
			}
			for (const [day, total] of targets) state.flushed[day] = Math.max(state.flushed[day] ?? 0, total);
		}

		// Past days that are fully in D1 are done; today stays (more views will add to it)
		const today = utcDay(this.now());
		for (const day of Object.keys(state.days)) {
			if (day < today && (state.flushed[day] ?? 0) >= state.days[day]) {
				delete state.days[day];
				delete state.flushed[day];
			}
		}
		await this.storage.put(POST_STATE_KEY, structuredClone(state));
		if (unflushed(state) > 0) await this.storage.setAlarm(this.now() + POST_FLUSH_DELAY_MS);
	}
}
