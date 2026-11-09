/**
 * Counting a view (docs/architecture/SCALABILITY-AUDIT.md, AV-1).
 *
 * Views go to a per-video Durable Object shard in the realtime worker
 * (apps/websocket-server/src/view-counter.ts), which is the single writer of
 * its count and flushes it into the video JSON with conditional writes. This
 * Worker never writes `views` itself on the normal path.
 *
 * A video's views are spread over VIEW_COUNTER_SHARDS objects so one hot
 * video is not capped by what a single object can serve.
 *
 * When the counter cannot be reached (binding missing in a preview, the
 * realtime worker not yet released with the counter, an outage), the view is
 * counted with a compare-and-swap increment of `views` instead. The counter
 * folds such increments into its base on its next flush, so neither path
 * loses the other's views.
 */
import R2Repository from './r2Repo';
import { logger } from './logger';

export const VIEW_COUNTER_SHARDS = 4;

export type CountedView =
	/** Counted by the shard: `unflushed` views of that shard are not in R2 yet. */
	| { via: 'counter'; unflushed: number }
	/** Counted directly in R2 (fallback): `views` is the stored count. */
	| { via: 'fallback'; views: number };

export function viewCounterName(videoId: string, shard: number): string {
	return `views:${videoId}:${shard}`;
}

async function countWithCounter(ns: DurableObjectNamespace, videoId: string, random: () => number): Promise<number> {
	const shard = Math.floor(random() * VIEW_COUNTER_SHARDS) % VIEW_COUNTER_SHARDS;
	const stub = ns.get(ns.idFromName(viewCounterName(videoId, shard)));
	const response = await stub.fetch('http://view-counter/views/increment', {
		method: 'POST',
		headers: { 'Content-Type': 'application/json' },
		body: JSON.stringify({ videoId, shard }),
	});
	if (!response.ok) throw new Error(`view counter answered ${response.status}`);
	const body = (await response.json()) as { unflushed?: unknown };
	if (typeof body.unflushed !== 'number') throw new Error('view counter sent no count');
	return body.unflushed;
}

/**
 * Counts one view of `videoId`. Throws only when both the counter and the
 * fallback failed (the view was not counted).
 */
export async function countView(
	env: { VIEW_COUNTER?: DurableObjectNamespace; videos: R2Bucket },
	videoId: string,
	random: () => number = Math.random,
): Promise<CountedView> {
	if (env.VIEW_COUNTER) {
		try {
			return { via: 'counter', unflushed: await countWithCounter(env.VIEW_COUNTER, videoId, random) };
		} catch (error) {
			logger.warn('[views] counter unavailable, counting in R2 directly', { videoId, error: String(error) });
		}
	}
	const repository = new R2Repository<{ views?: number }>(env.videos);
	const updated = await repository.updateObject(videoId, (video) => {
		video.views = (typeof video.views === 'number' && video.views > 0 ? video.views : 0) + 1;
	}, { maxAttempts: 8 });
	if (!updated) throw new Error(`video ${videoId} disappeared while counting a view`);
	return { via: 'fallback', views: updated.views ?? 0 };
}
