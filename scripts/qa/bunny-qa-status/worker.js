/**
 * Throwaway probe for QA's Bunny Stream library (issue #929), deployed and
 * deleted by .github/workflows/bunny-qa-status.yml. Reads the library through
 * the Stream API with the QA Secrets Store key and returns a summary. The key
 * never leaves the worker. QA only: the Secrets Store bindings name the QA
 * secrets, and when QA_LIBRARY_ID is set any other library id is refused.
 */
import { THEME_DEMO } from '../theme-demo-keep.ts';

const API = 'https://video.bunnycdn.com';
/** Never deleted, whatever their record says: theme-demo, seed and owner-pinned content (scripts/qa/theme-demo-keep.ts, e2e-leftovers KEEP_VIDEO_IDS). */
const KEEP = new Set([...THEME_DEMO.videoIds, '443418c1-dc70-43d9-944d-5388ab7dc4c3']);
/** A Bunny video younger than this may be an upload whose record lands seconds later. */
const MIN_AGE_MS = 60 * 60 * 1000;
/** A soft-deleted record's video goes once the delete is this old (tests restore within minutes). */
const SOFT_DELETED_MIN_AGE_MS = 30 * 60 * 1000;
const DELETE_BATCH = 100;
const STATUS = { 0: 'created', 1: 'uploaded', 2: 'processing', 3: 'transcoding', 4: 'finished', 5: 'error', 6: 'upload-failed', 7: 'jit-segmenting', 8: 'jit-playlists-created' };
const SETTING_KEYS = ['Name', 'VideoCount', 'StorageUsage', 'TrafficUsage', 'EnabledResolutions', 'KeepOriginalFiles', 'AllowEarlyPlay', 'EnableMP4Fallback', 'EnableTranscribing', 'EnableTranscribingTitleGeneration', 'EnableContentTagging', 'JitEncodingEnabled', 'EnableMultiAudioTrackSupport', 'OutputCodecs', 'EncodingTier', 'PremiumEncoding', 'EnableDRM', 'Bitrate240p', 'Bitrate360p', 'Bitrate480p', 'Bitrate720p', 'Bitrate1080p', 'Bitrate1440p', 'Bitrate2160p', 'WatermarkPositionLeft', 'RememberPlayerPosition', 'Replication', 'ReplicationRegions', 'StorageZoneId', 'PullZoneId'];

async function secret(binding) {
	return typeof binding === 'string' ? binding : await binding.get();
}

function envOf(title) {
	const m = /^\[([^\]]{1,32})\]\s/.exec(title || '');
	return m ? m[1] : 'qa';
}

async function bunny(key, path) {
	const r = await fetch(API + path, { headers: { AccessKey: key, accept: 'application/json' } });
	const text = await r.text();
	let body = null;
	try { body = JSON.parse(text); } catch { body = text.slice(0, 200); }
	return { status: r.status, body };
}

async function status(key, libraryId, videosBucket) {
	const videos = [];
	for (let page = 1; page < 200; page++) {
		const r = await bunny(key, `/library/${libraryId}/videos?page=${page}&itemsPerPage=1000&orderBy=date`);
		if (r.status !== 200) throw new Error(`list page ${page}: HTTP ${r.status}`);
		videos.push(...(r.body.items || []));
		if (!r.body.items?.length || videos.length >= r.body.totalItems) break;
	}
	const byStatus = {};
	const byEnvStatus = {};
	let storage = 0;
	const now = Date.now();
	for (const v of videos) {
		const s = STATUS[v.status] ?? String(v.status);
		byStatus[s] = (byStatus[s] || 0) + 1;
		const e = envOf(v.title);
		byEnvStatus[e] ??= {};
		byEnvStatus[e][s] = (byEnvStatus[e][s] || 0) + 1;
		storage += v.storageSize || 0;
	}
	const pending = videos.filter((v) => [0, 1, 2, 3, 7].includes(v.status));
	pending.sort((a, b) => Date.parse(a.dateUploaded) - Date.parse(b.dateUploaded));
	// Which pending QA videos still have a live record (the record key is the Bunny guid)
	const recordClass = {};
	const qaPending = pending.filter((v) => envOf(v.title) === 'qa').slice(0, 600); // subrequest budget
	const classOf = new Map();
	for (let i = 0; i < qaPending.length; i += 25) {
		await Promise.all(qaPending.slice(i, i + 25).map(async (v) => {
			const object = await videosBucket.get(v.guid);
			let c = 'no-record';
			if (object) {
				let r = {};
				try { r = await object.json(); } catch { r = {}; }
				c = r.isDeleted === true ? 'soft-deleted' : `live:${r.uploadStatus ?? r.status ?? '?'}`;
			}
			classOf.set(v.guid, c);
			recordClass[c] = (recordClass[c] || 0) + 1;
		}));
	}
	const view = (v) => ({ guid: v.guid, title: (v.title || '').slice(0, 60), status: STATUS[v.status] ?? v.status, encodeProgress: v.encodeProgress, ageMin: Math.round((now - Date.parse(v.dateUploaded + (v.dateUploaded?.endsWith('Z') ? '' : 'Z'))) / 60000), length: v.length, storageSize: v.storageSize, availableResolutions: v.availableResolutions, record: classOf?.get(v.guid) });
	// Encode speed: recently finished videos (dateUploaded → now is not encode time, so only the age and length are shown)
	const recentFinished = videos.filter((v) => v.status === 4).slice(0, 10).map(view);
	const recentAny = videos.slice(0, 15).map(view);
	const inProgress = videos.filter((v) => v.status === 3 || (v.status === 2 && v.encodeProgress > 0)).map(view);
	const resolutions = {};
	for (const v of videos) if (v.status === 4) resolutions[v.availableResolutions || ''] = (resolutions[v.availableResolutions || ''] || 0) + 1;

	const settings = {};
	for (const path of [`/library/${libraryId}`, `/library/${libraryId}/statistics`]) {
		const r = await bunny(key, path);
		settings[path.replace(libraryId, '<id>')] = { http: r.status, body: r.body && typeof r.body === 'object' ? pick(r.body) : r.body };
	}
	const acct = await fetch(`https://api.bunny.net/videolibrary/${libraryId}`, { headers: { AccessKey: key, accept: 'application/json' } });
	let acctBody = null;
	if (acct.ok) acctBody = pick(await acct.json());
	settings['api.bunny.net/videolibrary/<id>'] = { http: acct.status, body: acctBody };

	// Leak census: who created what, grouped by title shape (digits → #, hex ids → *) and UTC hour
	const shape = (t) => (t || '').replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, '*').replace(/\d+/g, '#').slice(0, 48);
	const byShape = {};
	const byHour = {};
	const runIds = {};
	for (const v of videos) {
		const k = shape(v.title);
		byShape[k] = (byShape[k] || 0) + 1;
		const h = (v.dateUploaded || '').slice(0, 13);
		byHour[h] = (byHour[h] || 0) + 1;
		const run = /(\d{10,11})-(\d{1,2})/.exec(v.title || '');
		if (run) runIds[run[0]] = (runIds[run[0]] || 0) + 1;
	}
	const top = (o, n) => Object.entries(o).sort((a, b) => b[1] - a[1]).slice(0, n);
	const census = { byTitleShape: top(byShape, 40), byHourUTC: Object.entries(byHour).sort().slice(-36), byRunId: top(runIds, 40) };

	return {
		census,
		libraryId,
		at: new Date().toISOString(),
		total: videos.length,
		storageBytes: storage,
		storageGB: +(storage / 1e9).toFixed(2),
		byStatus,
		byEnvStatus,
		pendingCount: pending.length,
		qaPendingByRecord: recordClass,
		oldestPending: pending.slice(0, 25).map(view),
		newestPending: pending.slice(-10).map(view),
		inProgress: inProgress.slice(0, 25),
		recentFinished,
		recentAny,
		finishedResolutions: resolutions,
		settings,
	};
}

function uploadedAt(v) {
	const d = v.dateUploaded || '';
	return Date.parse(d.endsWith('Z') ? d : d + 'Z');
}

/** Why a video must stay, or null when nothing refers to it. Unreadable or unknown always keeps. */
async function keepReason(v, buckets, lives, now) {
	if (!v || !v.guid) return 'no-id';
	const e = envOf(v.title);
	const videosBucket = buckets[e];
	// Only QA (no prefix) and stage ("[stage] "), each checked against its own records
	if (!videosBucket) return 'other-env';
	if (KEEP.has(v.guid)) return 'keep-list';
	const at = uploadedAt(v);
	if (!Number.isFinite(at) || now - at < MIN_AGE_MS) return 'young';
	if ((lives[e] || []).some((t) => t.includes(v.guid))) return 'live-stream';
	const object = await videosBucket.get(v.guid);
	if (!object) return null;
	let r;
	try { r = await object.json(); } catch { return 'unreadable-record'; }
	if (!r || typeof r !== 'object') return 'unreadable-record';
	if (r.isDeleted !== true) return 'live-record';
	const deletedAt = Date.parse(r.deletedAt || r.ownerDeletion?.at || '');
	if (!Number.isFinite(deletedAt) || now - deletedAt < SOFT_DELETED_MIN_AGE_MS) return 'recently-deleted';
	return null;
}

async function liveStreams(videosBucket) {
	const texts = [];
	let cursor;
	do {
		const page = await videosBucket.list({ prefix: 'livestream:', cursor, limit: 500 });
		for (const o of page.objects) {
			const t = await (await videosBucket.get(o.key))?.text();
			if (t) texts.push(t);
		}
		cursor = page.truncated ? page.cursor : undefined;
	} while (cursor);
	return texts;
}

/** One library page (DELETE_BATCH videos, newest first): what would go, and with apply, delete up to DELETE_BATCH of it. */
async function sweep(key, libraryId, buckets, page, apply) {
	const r = await bunny(key, `/library/${libraryId}/videos?page=${page}&itemsPerPage=${DELETE_BATCH}&orderBy=date`);
	if (r.status !== 200) throw new Error(`list page ${page}: HTTP ${r.status}`);
	const items = r.body.items || [];
	const lives = {};
	for (const [e, b] of Object.entries(buckets)) lives[e] = await liveStreams(b);
	const now = Date.now();
	const kept = {};
	const candidates = [];
	const byEnv = {};
	for (let i = 0; i < items.length; i += 25) {
		await Promise.all(items.slice(i, i + 25).map(async (v) => {
			const reason = await keepReason(v, buckets, lives, now);
			if (reason) kept[reason] = (kept[reason] || 0) + 1;
			else { candidates.push(v); byEnv[envOf(v.title)] = (byEnv[envOf(v.title)] || 0) + 1; }
		}));
	}
	const deleted = [];
	const failed = [];
	const deletedByStatus = {};
	if (apply) {
		for (let i = 0; i < candidates.length; i += 20) {
			await Promise.all(candidates.slice(i, i + 20).map(async (v) => {
				const res = await fetch(`${API}/library/${libraryId}/videos/${encodeURIComponent(v.guid)}`, { method: 'DELETE', headers: { AccessKey: key } });
				if (res.ok || res.status === 404) {
					deleted.push(v.guid);
					const s = STATUS[v.status] ?? String(v.status);
					deletedByStatus[s] = (deletedByStatus[s] || 0) + 1;
				} else failed.push({ guid: v.guid, http: res.status });
			}));
		}
	}
	const wouldByStatus = {};
	for (const v of candidates) { const s = STATUS[v.status] ?? String(v.status); wouldByStatus[s] = (wouldByStatus[s] || 0) + 1; }
	return { page, candidatesByEnv: byEnv, listed: items.length, totalItems: r.body.totalItems, kept, candidates: candidates.length, wouldByStatus, deleted: deleted.length, deletedByStatus, failed, sample: candidates.slice(0, 5).map((v) => ({ guid: v.guid, title: (v.title || '').slice(0, 60), status: STATUS[v.status] ?? v.status })) };
}

function pick(body) {
	if (Array.isArray(body)) return { array: body.length };
	const out = {};
	for (const k of Object.keys(body)) {
		if (/key|token|secret|password|apikey/i.test(k)) continue;
		if (SETTING_KEYS.includes(k) || typeof body[k] !== 'object') out[k] = body[k];
	}
	return out;
}

export default {
	async fetch(request, env) {
		const auth = request.headers.get('authorization') || '';
		const expected = await secret(env.PROBE_TOKEN);
		if (!expected || auth !== `Bearer ${expected}`) return new Response('forbidden', { status: 403 });
		const key = await secret(env.BUNNY_KEY);
		const libraryId = String(await secret(env.BUNNY_LIBRARY_ID)).trim();
		if (!/^\d+$/.test(libraryId)) return Response.json({ error: 'library id is not numeric' }, { status: 500 });
		if (env.QA_LIBRARY_ID && libraryId !== env.QA_LIBRARY_ID) return Response.json({ error: `refusing library ${libraryId}: not QA (${env.QA_LIBRARY_ID})` }, { status: 403 });
		const url = new URL(request.url);
		try {
			if (url.pathname === '/list') {
				// Compact listing for the per-run census (no keys, no URLs)
				const rows = [];
				for (let page = 1; page < 200; page++) {
					const r = await bunny(key, `/library/${libraryId}/videos?page=${page}&itemsPerPage=1000&orderBy=date`);
					if (r.status !== 200) throw new Error(`list page ${page}: HTTP ${r.status}`);
					for (const v of r.body.items || []) rows.push([v.guid, v.title || '', v.dateUploaded || '', v.status, v.encodeProgress ?? null]);
					if (!r.body.items?.length || rows.length >= r.body.totalItems) break;
				}
				return Response.json({ libraryId, at: new Date().toISOString(), rows });
			}
			if (url.pathname === '/status') return Response.json(await status(key, libraryId, env.videos));
			if (url.pathname === '/sweep') {
				const apply = url.searchParams.get('apply') === '1';
				// Deleting needs the pinned QA library id: never another library
				if (apply && (!env.QA_LIBRARY_ID || libraryId !== env.QA_LIBRARY_ID)) return Response.json({ error: 'apply needs QA_LIBRARY_ID pinned to this library' }, { status: 403 });
				const page = Math.max(1, Number(url.searchParams.get('page') || 1));
				return Response.json(await sweep(key, libraryId, { qa: env.videos, stage: env.videos_stage }, page, apply));
			}
			return new Response('not found', { status: 404 });
		} catch (e) {
			return Response.json({ error: String(e?.message || e) }, { status: 500 });
		}
	},
};
