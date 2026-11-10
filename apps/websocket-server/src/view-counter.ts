/**
 * Per-video view counter (docs/architecture/SCALABILITY-AUDIT.md, AV-1).
 *
 * The count a viewer sees stays in the video JSON in R2 (`views`), so every
 * reader keeps working. What changes is who writes it: instead of each API
 * isolate doing get → views+1 → put (which drops concurrent increments, and
 * whose blind put can revert a concurrent metadata edit), each view goes to
 * one Durable Object shard, named `views:<videoId>:<shard>`. A shard is the
 * single writer of its own cumulative total, and flushes it into the video
 * JSON a few seconds later with an etag-conditional put.
 *
 * The JSON keeps the totals per shard:
 *
 *   viewCounter: { base, shards: { "0": 812, "1": 790, ... } }
 *   views = base + Σ shards
 *
 * A flush sets `shards[k] = max(stored, mine)`. That makes a flush idempotent
 * (a retried or replayed flush cannot double count) and makes the count
 * self-healing: a writer elsewhere that does a blind read-modify-write of the
 * video (many endpoints in api-videos, admin-api and the scheduler still do)
 * can only revert flushes that landed between its own read and write, which
 * is seconds. Each shard therefore re-asserts its total after every flush
 * (VERIFY_DELAYS_MS), and any such revert is repaired.
 *
 * Those R2 writes do not pass through api-videos, so the indexes (D1
 * content_ownership and search_videos) never saw them: channel totals,
 * popular sorts and trending kept the views of each video's last edit. After
 * every flush that changed the count, the shard raises the views in both
 * indexes (shared-types syncVideoViews, one batch per flush). A failed sync
 * is retried on the next alarm; after INDEX_MAX_FAILURES the video is handed
 * to the api-videos repair job (index_repairs, Errors page with Retry), which
 * rewrites its rows from R2.
 *
 * `base` is the count from before the counter existed. Views that reach
 * `views` some other way (an older API version during a gradual rollout, or
 * the API's fallback when this object is unreachable) show up as
 * `views > base + Σ shards`, and are folded into `base` rather than lost.
 */

/** Wait after the first unflushed view, so a hot video costs one R2 write per shard per window. */
export const FLUSH_DELAY_MS = 10_000;
/** Re-assert the total this long after each flush that changed it (see header). */
export const VERIFY_DELAYS_MS = [30_000, 300_000] as const;
/** Back-off when R2 is unavailable or the conditional put keeps losing. */
export const RETRY_DELAY_MS = 30_000;
/** Index sync attempts before the video is handed to the repair job. */
export const INDEX_MAX_FAILURES = 5;

const STATE_KEY = 'viewCounter';

export interface ViewCounterDoc {
	base: number;
	shards: Record<string, number>;
}

export interface ViewCounterState {
	videoId: string;
	shard: string;
	/** Views this shard has counted, ever. */
	total: number;
	/** The part of `total` confirmed in R2. */
	flushed: number;
	/** Re-asserts left after the last flush that changed R2. */
	verifies: number;
	/** Views last written to the indexes (absent: never). */
	indexed?: number;
	/** Index syncs that failed in a row. */
	indexFailures?: number;
}

/** Where the counter mirrors a flushed count (D1 indexes; see header). */
export interface ViewIndex {
	sync(videoId: string, views: number): Promise<void>;
	/** Hand the video to the repair job after repeated failures (records it in index_repairs). */
	recordRepair(videoId: string, error: string): Promise<void>;
}

/** The subset of DurableObjectStorage the counter uses. */
export interface CounterStorage {
	get<T>(key: string): Promise<T | undefined>;
	put<T>(key: string, value: T): Promise<void>;
	deleteAll(): Promise<void>;
	getAlarm(): Promise<number | null>;
	setAlarm(scheduledTime: number): Promise<void>;
	deleteAlarm(): Promise<void>;
}

/** The subset of R2Bucket the counter uses. */
export interface VideoBucket {
	get(key: string): Promise<{ etag: string; json<T>(): Promise<T> } | null>;
	put(key: string, value: string, options: { httpMetadata: { contentType: string }; onlyIf: { etagMatches: string } }): Promise<unknown | null>;
}

export interface ViewCounterLogger {
	warn(message: string, meta?: unknown): void;
	error(message: string, meta?: unknown): void;
}

function isDoc(value: unknown): value is ViewCounterDoc {
	if (!value || typeof value !== 'object') return false;
	const doc = value as ViewCounterDoc;
	return Number.isFinite(doc.base) && !!doc.shards && typeof doc.shards === 'object';
}

function sum(shards: Record<string, number>): number {
	let total = 0;
	for (const n of Object.values(shards)) if (Number.isFinite(n)) total += n;
	return total;
}

/**
 * Merges one shard's total into a video object, in place. Returns false when
 * the object already says so (nothing to write). Pure, so it can run inside a
 * compare-and-swap retry loop.
 */
export function mergeViewCounter(video: Record<string, unknown>, shard: string, total: number): boolean {
	const views = typeof video.views === 'number' && Number.isFinite(video.views) && video.views > 0 ? video.views : 0;
	const existing = isDoc(video.viewCounter) ? video.viewCounter : null;
	const counter: ViewCounterDoc = existing
		? { base: existing.base, shards: { ...existing.shards } }
		: { base: views, shards: {} };

	// Views counted outside the shards (older API version, fallback path)
	const outside = views - (counter.base + sum(counter.shards));
	if (outside > 0) counter.base += outside;

	counter.shards[shard] = Math.max(counter.shards[shard] ?? 0, total);
	const next = counter.base + sum(counter.shards);

	const unchanged =
		existing !== null &&
		existing.base === counter.base &&
		existing.shards[shard] === counter.shards[shard] &&
		views === next;
	if (unchanged) return false;

	video.viewCounter = counter;
	video.views = next;
	return true;
}

type FlushResult = { status: 'missing' } | { status: 'unchanged' | 'written'; views: number };

/** Compare-and-swap of one video JSON object (R2 conditional put on the etag). */
async function mergeIntoVideo(bucket: VideoBucket, videoId: string, shard: string, total: number, maxAttempts = 8): Promise<FlushResult> {
	for (let attempt = 1; attempt <= maxAttempts; attempt++) {
		const object = await bucket.get(videoId);
		if (!object) return { status: 'missing' };
		const video = await object.json<Record<string, unknown>>();
		if (!mergeViewCounter(video, shard, total)) return { status: 'unchanged', views: video.views as number };
		const written = await bucket.put(videoId, JSON.stringify(video), {
			httpMetadata: { contentType: 'application/json' },
			onlyIf: { etagMatches: object.etag },
		});
		if (written) return { status: 'written', views: video.views as number };
	}
	throw new Error(`view counter: ${videoId} kept changing, gave up after ${maxAttempts} attempts`);
}

export class ViewCounter {
	private state: ViewCounterState | null | undefined;

	constructor(
		private readonly storage: CounterStorage,
		private readonly bucket: VideoBucket | undefined,
		private readonly opts: {
			/** Called after a flush changed the stored count (pushes it to viewers). */
			onFlushed?: (videoId: string, views: number) => Promise<void>;
			/** Mirrors flushed counts into the indexes (absent: SEARCH_DB not bound). */
			index?: ViewIndex;
			logger?: ViewCounterLogger;
			now?: () => number;
		} = {},
	) {}

	private now(): number {
		return this.opts.now ? this.opts.now() : Date.now();
	}

	private loading?: Promise<void>;

	/**
	 * Loads the state once, however many requests arrive while it loads (all of
	 * them must then share one state object, or their increments are lost).
	 */
	private async load(): Promise<ViewCounterState | null> {
		if (this.state === undefined) {
			this.loading ??= this.storage.get<ViewCounterState>(STATE_KEY).then((stored) => {
				if (this.state === undefined) this.state = stored ?? null;
			});
			await this.loading;
		}
		return this.state ?? null;
	}

	/** Counts one view. Resolves once the view is durable in this object's storage. */
	async increment(videoId: string, shard: string): Promise<{ unflushed: number }> {
		await this.load();
		// From here on synchronous until the put: no other request can interleave
		this.state ??= { videoId, shard, total: 0, flushed: 0, verifies: 0 };
		const state = this.state;
		if (state.videoId !== videoId || state.shard !== shard) {
			throw new Error(`view counter: object for ${state.videoId}/${state.shard} got a view for ${videoId}/${shard}`);
		}
		state.total += 1;
		await this.storage.put(STATE_KEY, { ...state });
		if ((await this.storage.getAlarm()) === null) await this.storage.setAlarm(this.now() + FLUSH_DELAY_MS);
		return { unflushed: state.total - state.flushed };
	}

	/**
	 * Mirror `views` into the indexes. True when done (or handed to the repair
	 * job after INDEX_MAX_FAILURES), false when the next alarm must retry.
	 */
	private async syncIndex(state: ViewCounterState, views: number): Promise<boolean> {
		const index = this.opts.index!;
		try {
			await index.sync(state.videoId, views);
			state.indexed = views;
			state.indexFailures = 0;
			return true;
		} catch (error) {
			state.indexFailures = (state.indexFailures ?? 0) + 1;
			if (state.indexFailures < INDEX_MAX_FAILURES) {
				this.opts.logger?.warn('view counter: index sync failed, retrying', { videoId: state.videoId, attempts: state.indexFailures, error: String(error) });
				return false;
			}
			try {
				await index.recordRepair(state.videoId, String(error));
				this.opts.logger?.warn('view counter: index sync failed; video queued for repair', { videoId: state.videoId, attempts: state.indexFailures, error: String(error) });
				state.indexed = views;
				state.indexFailures = 0;
				return true;
			} catch (recordError) {
				this.opts.logger?.error('view counter: index sync and repair record failed', {
					alert: 'index_views_sync_failed',
					videoId: state.videoId,
					attempts: state.indexFailures,
					error: String(error),
					recordError: String(recordError),
				});
				return false;
			}
		}
	}

	/** Alarm handler: flush, then schedule the next flush or re-assert. Never throws. */
	async alarm(): Promise<void> {
		const state = await this.load();
		if (!state) return;
		if (!this.bucket) {
			this.opts.logger?.error('view counter: no VIDEOS bucket bound, cannot flush', { videoId: state.videoId });
			await this.storage.setAlarm(this.now() + RETRY_DELAY_MS);
			return;
		}

		const target = state.total;
		let result: FlushResult;
		try {
			result = await mergeIntoVideo(this.bucket, state.videoId, state.shard, target);
		} catch (error) {
			this.opts.logger?.warn('view counter: flush failed, retrying', { videoId: state.videoId, shard: state.shard, error: String(error) });
			await this.storage.setAlarm(this.now() + RETRY_DELAY_MS);
			return;
		}

		if (result.status === 'missing') {
			// Video deleted: its count goes with it
			this.state = null;
			await this.storage.deleteAlarm();
			await this.storage.deleteAll();
			return;
		}

		// Any write (a new total, or a repaired revert) can itself be reverted: verify it again
		if (target > state.flushed) state.flushed = target;
		if (result.status === 'written') state.verifies = VERIFY_DELAYS_MS.length;

		let next: number | null = null;
		if (state.total > state.flushed) {
			next = this.now() + FLUSH_DELAY_MS;
		} else if (state.verifies > 0) {
			next = this.now() + VERIFY_DELAYS_MS[VERIFY_DELAYS_MS.length - state.verifies];
			state.verifies -= 1;
		}

		// The indexes follow the stored count (header); retried until they do
		if (this.opts.index && result.views > (state.indexed ?? -1)) {
			const indexPending = !(await this.syncIndex(state, result.views));
			const retryAt = this.now() + RETRY_DELAY_MS;
			if (indexPending && (next === null || next > retryAt)) next = retryAt;
		}
		await this.storage.put(STATE_KEY, { ...state });
		if (next !== null) await this.storage.setAlarm(next);

		if (result.status === 'written' && this.opts.onFlushed) {
			try {
				await this.opts.onFlushed(state.videoId, result.views);
			} catch (error) {
				this.opts.logger?.warn('view counter: broadcast failed', { videoId: state.videoId, error: String(error) });
			}
		}
	}
}

/** Object name of one shard. The API spreads a video's views over `shards` of them. */
export function viewCounterName(videoId: string, shard: number | string): string {
	return `views:${videoId}:${shard}`;
}
