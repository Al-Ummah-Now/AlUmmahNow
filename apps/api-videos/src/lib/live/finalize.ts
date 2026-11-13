/**
 * Self-hosted end of session: the live playlists get #EXT-X-ENDLIST (players
 * watching stop cleanly) and, when recording is on, a VOD master and one VOD
 * media playlist per rendition are written from the segment index
 * (live_segments), with a discontinuity at each reconnect. Without recording
 * the session's objects are deleted.
 */
import { logger } from '../logger';
import type { LiveEnv } from './providers';
import { readSession, recordEvent, updateSession, type LiveSessionRow } from './store';
import { vodReady } from './vod-ready';

const prefix = (sessionId: string) => `live/${sessionId}/`;
const PLAYLIST_CACHE = 'public, max-age=1';
const VOD_CACHE = 'public, max-age=300';

type SegRow = { rendition: string; seq: number; uri: string; duration: number; bytes: number; received_at: number };

/** Builds a VOD media playlist; a gap in the sequence (a reconnect) starts a discontinuity. */
export function vodMediaPlaylist(segments: Pick<SegRow, 'seq' | 'uri' | 'duration'>[], initUri: string | null): string {
	const target = Math.max(1, Math.ceil(Math.max(0, ...segments.map((s) => s.duration))));
	const lines = ['#EXTM3U', '#EXT-X-VERSION:7', `#EXT-X-TARGETDURATION:${target}`, '#EXT-X-PLAYLIST-TYPE:VOD', '#EXT-X-MEDIA-SEQUENCE:0', '#EXT-X-INDEPENDENT-SEGMENTS'];
	if (initUri) lines.push(`#EXT-X-MAP:URI="${initUri}"`);
	let prev: number | null = null;
	for (const s of segments) {
		if (prev !== null && s.seq !== prev + 1) lines.push('#EXT-X-DISCONTINUITY');
		lines.push(`#EXTINF:${s.duration.toFixed(3)},`, s.uri);
		prev = s.seq;
	}
	lines.push('#EXT-X-ENDLIST', '');
	return lines.join('\n');
}

/** The live master with each variant URI pointed at its VOD playlist. */
export function vodMaster(liveMaster: string): string {
	return liveMaster
		.split('\n')
		.map((l) => (l && !l.startsWith('#') ? l.replace(/index\.m3u8$/, 'vod.m3u8') : l))
		.join('\n');
}

export async function finalizeSelfHosted(env: LiveEnv, session: LiveSessionRow, opts: { recordVod: boolean; now?: number }): Promise<void> {
	const bucket = env.LIVE_MEDIA;
	const d1 = env.SEARCH_DB;
	if (!bucket || !d1) return;
	const now = opts.now ?? Date.now();
	const base = prefix(session.id);
	const { results } = await d1
		.prepare('SELECT rendition, seq, uri, duration, bytes, received_at FROM live_segments WHERE session_id = ? AND duration > 0 ORDER BY rendition, seq')
		.bind(session.id)
		.all<SegRow>();
	const byRendition = new Map<string, SegRow[]>();
	for (const r of results ?? []) {
		const list = byRendition.get(r.rendition) ?? [];
		list.push(r);
		byRendition.set(r.rendition, list);
	}
	let writes = 0;
	// Live playlists end, so players at the edge stop instead of waiting.
	// Each rendition's init segment is the live playlist's EXT-X-MAP (ffmpeg names it init_<n>.mp4).
	const initUris = new Map<string, string>();
	for (const rendition of byRendition.keys()) {
		const live = await bucket.get(`${base}${rendition}/index.m3u8`);
		if (!live) continue;
		const text = await live.text();
		const map = /#EXT-X-MAP:URI="([^"]+)"/.exec(text);
		if (map) initUris.set(rendition, map[1]);
		if (!text.includes('#EXT-X-ENDLIST')) {
			await bucket.put(`${base}${rendition}/index.m3u8`, `${text.trimEnd()}\n#EXT-X-ENDLIST\n`, {
				httpMetadata: { contentType: 'application/vnd.apple.mpegurl', cacheControl: PLAYLIST_CACHE },
			});
			writes++;
		}
	}
	// Ingest totals from the segment index (authoritative across isolates)
	await d1
		.prepare('UPDATE live_sessions SET segments = ?, ingest_bytes = ? WHERE id = ?')
		.bind(results?.length ?? 0, (results ?? []).reduce((n, r) => n + (r.bytes || 0), 0), session.id)
		.run();
	if (!opts.recordVod || !byRendition.size) {
		if (!opts.recordVod) await deletePrefix(bucket, base);
		await d1.prepare('UPDATE live_sessions SET r2_writes = r2_writes + ? WHERE id = ?').bind(writes, session.id).run();
		return;
	}
	let stored = 0;
	for (const [rendition, segs] of byRendition) {
		stored += segs.reduce((n, s) => n + (s.bytes || 0), 0);
		await bucket.put(`${base}${rendition}/vod.m3u8`, vodMediaPlaylist(segs, initUris.get(rendition) ?? null), {
			httpMetadata: { contentType: 'application/vnd.apple.mpegurl', cacheControl: VOD_CACHE },
		});
		writes++;
	}
	const master = await bucket.get(`${base}master.m3u8`);
	const masterText = master ? await master.text() : syntheticMaster([...byRendition.keys()]);
	await bucket.put(`${base}vod.m3u8`, vodMaster(masterText), { httpMetadata: { contentType: 'application/vnd.apple.mpegurl', cacheControl: VOD_CACHE } });
	writes++;
	const host = env.LIVE_PUBLIC_HOST;
	const readyAt = Date.now();
	await updateSession(d1, session.id, { vod_url: host ? `https://${host}/hls/${session.id}/vod.m3u8` : null, vod_ready_at: readyAt, stored_bytes: stored });
	await d1.prepare('UPDATE live_sessions SET r2_writes = r2_writes + ? WHERE id = ?').bind(writes, session.id).run();
	await recordEvent(d1, { sessionId: session.id, provider: 'selfhosted', kind: 'vod_ready', at: readyAt, value: readyAt - now, detail: { renditions: byRendition.size, segments: results?.length ?? 0, storedBytes: stored } });
	const ready = await readSession(d1, session.id);
	if (ready?.vod_url) await vodReady(env, ready);
	logger.info('[Live] Self-hosted VOD ready', { sessionId: session.id, renditions: byRendition.size, segments: results?.length ?? 0, ms: readyAt - now });
}

function syntheticMaster(renditions: string[]): string {
	const bw: Record<string, [number, string]> = { '720': [3_000_000, '1280x720'], '480': [1_400_000, '854x480'], '360': [850_000, '640x360'] };
	const lines = ['#EXTM3U', '#EXT-X-VERSION:7', '#EXT-X-INDEPENDENT-SEGMENTS'];
	for (const r of renditions) {
		const [b, res] = bw[r] ?? [2_000_000, ''];
		lines.push(`#EXT-X-STREAM-INF:BANDWIDTH=${b}${res ? `,RESOLUTION=${res}` : ''}`, `${r}/index.m3u8`);
	}
	return lines.join('\n') + '\n';
}

async function deletePrefix(bucket: R2Bucket, base: string): Promise<void> {
	let cursor: string | undefined;
	for (let page = 0; page < 50; page++) {
		const list = await bucket.list({ prefix: base, cursor, limit: 1000 });
		if (list.objects.length) await bucket.delete(list.objects.map((o) => o.key));
		if (!list.truncated) break;
		cursor = list.cursor;
	}
}
