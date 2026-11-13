/**
 * IndexNow for the videos site (wiki AUN-SEO): tells Bing, Yandex and the other IndexNow engines
 * which watch pages changed, so they recrawl them within minutes instead of waiting for the
 * sitemap. Google does not use IndexNow; it reads the sitemap.
 *
 * Trigger points: D1 triggers on search_videos (migrations/search/0030_indexnow_pending.sql) queue
 * a video whenever its public page appears, changes content or goes away, whoever wrote it
 * (api-videos, the processor for the scheduler's releases, admin-api). The 10-minute cron flushes
 * the queue in one POST. Production only: QA and stage just empty the queue.
 * The key is public by design: the web app serves it at /<key>.txt (apps/web/public).
 */
import { webOrigin } from './media/public-play';
import { logger } from './logger';

/** The same key as www (CMS src/lib/indexnow.ts): one key file per host. */
export const INDEXNOW_KEY = '9e1b0c3eec45ae20f6d905e0d4c5b004';
export const INDEXNOW_ENDPOINT = 'https://api.indexnow.org/indexnow';
/** The protocol's limit per request. */
export const INDEXNOW_MAX_URLS = 10_000;
const LOCALES = ['en', 'ar'] as const;
/** At most 4 URLs per video (2 locales x /video and /shorts): a full batch stays under the limit. */
export const INDEXNOW_MAX_VIDEOS = Math.floor(INDEXNOW_MAX_URLS / 4);
/** D1 binds at most 100 parameters per statement. */
const DELETE_CHUNK = 90;
const SAFE_ID = /^[A-Za-z0-9_-]{1,128}$/;

export interface PendingVideo {
	video_id: string;
	is_short: number | boolean;
	queued_at?: number;
}

export interface IndexNowEnv {
	ENVIRONMENT?: string;
	CORS_ORIGINS?: string;
	SEARCH_DB?: D1Database;
}

/**
 * The watch pages of changed videos, en and ar. A Short's page is /shorts/<id> (D-SEO-10, the
 * public-play watchUrl rule); its /video/<id> is sent too, since that address was its page before
 * /shorts and now redirects there. Removed videos are sent the same way: IndexNow takes gone URLs.
 */
export function indexNowUrls(origin: string, videos: PendingVideo[]): string[] {
	const base = origin.replace(/\/+$/, '');
	const urls: string[] = [];
	for (const v of videos) {
		if (!SAFE_ID.test(v.video_id)) continue;
		const id = encodeURIComponent(v.video_id);
		const kinds = Number(v.is_short) ? ['shorts', 'video'] : ['video'];
		for (const locale of LOCALES) for (const kind of kinds) urls.push(`${base}/${locale}/${kind}/${id}`);
	}
	return [...new Set(urls)].slice(0, INDEXNOW_MAX_URLS);
}

/** 2xx: accepted. A 4xx other than 429 is our request or key: retrying cannot fix it. */
function settled(status: number): boolean {
	return (status >= 200 && status < 300) || (status >= 400 && status < 500 && status !== 429);
}

export interface FlushResult {
	sent: number;
	videos: number;
	status?: number;
	/** Rows emptied without a ping (not production). */
	cleared?: number;
}

/**
 * Sends the queued watch pages (oldest first, one POST of at most 10,000 URLs) and removes the rows
 * it sent. A row queued again after this read keeps its newer queued_at and stays for the next run.
 * On a network error, 429 or 5xx the rows stay and the next run resends them.
 */
export async function flushIndexNow(env: IndexNowEnv, fetcher: typeof fetch = fetch): Promise<FlushResult> {
	const db = env.SEARCH_DB;
	if (!db) return { sent: 0, videos: 0 };
	if (env.ENVIRONMENT !== 'production') {
		const out = (await db.prepare('DELETE FROM indexnow_pending').run()) as { meta?: { changes?: number } };
		return { sent: 0, videos: 0, cleared: Number(out?.meta?.changes ?? 0) };
	}
	const { results } = await db
		.prepare('SELECT video_id, is_short, queued_at FROM indexnow_pending ORDER BY queued_at LIMIT ?')
		.bind(INDEXNOW_MAX_VIDEOS)
		.all<PendingVideo>();
	const rows = results ?? [];
	if (rows.length === 0) return { sent: 0, videos: 0 };
	const origin = webOrigin(env.CORS_ORIGINS);
	const urlList = indexNowUrls(origin, rows);
	let status: number | undefined;
	if (urlList.length > 0) {
		try {
			const res = await fetcher(INDEXNOW_ENDPOINT, {
				method: 'POST',
				headers: { 'Content-Type': 'application/json; charset=utf-8' },
				body: JSON.stringify({ host: new URL(origin).host, key: INDEXNOW_KEY, keyLocation: `${origin}/${INDEXNOW_KEY}.txt`, urlList }),
			});
			status = res.status;
		} catch (error) {
			logger.warn('[IndexNow] Ping failed; retried next run', { urls: urlList.length, error: error instanceof Error ? error.message : String(error) });
			return { sent: 0, videos: rows.length };
		}
		if (!settled(status)) {
			logger.warn('[IndexNow] Ping not accepted; retried next run', { status, urls: urlList.length });
			return { sent: 0, videos: rows.length, status };
		}
		if (status >= 400) logger.warn('[IndexNow] Ping refused; dropped', { status, urls: urlList.length });
	}
	const readAt = Math.max(...rows.map((r) => Number(r.queued_at ?? 0)));
	const ids = rows.map((r) => r.video_id);
	const statements: D1PreparedStatement[] = [];
	for (let i = 0; i < ids.length; i += DELETE_CHUNK) {
		const chunk = ids.slice(i, i + DELETE_CHUNK);
		statements.push(
			db.prepare(`DELETE FROM indexnow_pending WHERE queued_at <= ? AND video_id IN (${chunk.map(() => '?').join(', ')})`).bind(readAt, ...chunk),
		);
	}
	await db.batch(statements);
	return { sent: status !== undefined && status < 300 ? urlList.length : 0, videos: rows.length, status };
}
