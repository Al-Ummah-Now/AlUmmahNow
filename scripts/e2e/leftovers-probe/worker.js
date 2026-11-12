/**
 * Read-only leftover probe for one E2E run on QA (scripts/e2e/run-leftovers.ts), deployed under a
 * per-run name and deleted again by release-e2e.yml, the same way bunny-qa-status.yml probes the
 * library (#951). The Bunny Stream key stays in the Cloudflare Secrets Store: it is bound here and
 * never leaves this worker. QA only: the bindings name the QA secrets and the QA buckets.
 *
 * GET  /bunny?marker=<run id>  videos and collections of the QA library whose title/name holds the marker
 * POST /r2 {videoIds: [...]}   R2 objects under each id: thumbnails/<id>/ (videos), pub/<id>/ (media),
 *                              priv/<id>/ (media-private), src/<id>/ (originals: source and upload parts)
 * Nothing is ever written or deleted. Every call needs Authorization: Bearer <PROBE_TOKEN>.
 */
const API = 'https://video.bunnycdn.com';
const MARKER = /^\d{1,20}-\d{1,3}$/;
const ID = /^[0-9a-f-]{36}$/;

async function secret(binding) {
	return typeof binding === 'string' ? binding : await binding.get();
}

async function bunnyList(key, path) {
	const r = await fetch(API + path, { headers: { AccessKey: key, accept: 'application/json' } });
	if (!r.ok) throw new Error(`${path.split('?')[0]}: HTTP ${r.status}`);
	return r.json();
}

async function bunny(env, marker) {
	const key = await secret(env.BUNNY_KEY);
	const libraryId = await secret(env.BUNNY_LIBRARY_ID);
	const videos = [];
	for (let page = 1; page < 50; page++) {
		const body = await bunnyList(key, `/library/${libraryId}/videos?page=${page}&itemsPerPage=100&search=${encodeURIComponent(marker)}`);
		const items = body.items || [];
		for (const v of items) if ((v.title || '').includes(marker)) videos.push({ guid: v.guid, title: v.title, status: v.status, dateUploaded: v.dateUploaded });
		if (!items.length || page * 100 >= (body.totalItems || 0)) break;
	}
	const collections = [];
	for (let page = 1; page < 50; page++) {
		const body = await bunnyList(key, `/library/${libraryId}/collections?page=${page}&itemsPerPage=100&search=${encodeURIComponent(marker)}`);
		const items = body.items || [];
		for (const c of items) if ((c.name || '').includes(marker)) collections.push({ guid: c.guid, name: c.name, videoCount: c.videoCount });
		if (!items.length || page * 100 >= (body.totalItems || 0)) break;
	}
	return { videos, collections };
}

async function r2(env, videoIds) {
	const prefixes = [
		['videos-qa', env.videos, (id) => `thumbnails/${id}/`],
		['media-qa', env.MEDIA, (id) => `pub/${id}/`],
		['media-private-qa', env.MEDIA_PRIVATE, (id) => `priv/${id}/`],
		['media-originals-qa', env.MEDIA_ORIGINALS, (id) => `src/${id}/`],
	];
	const objects = [];
	for (const id of videoIds) {
		for (const [bucket, binding, prefix] of prefixes) {
			const page = await binding.list({ prefix: prefix(id), limit: 5 });
			for (const o of page.objects) objects.push({ bucket, key: o.key, size: o.size });
		}
	}
	return { objects };
}

export default {
	async fetch(request, env) {
		if (request.headers.get('Authorization') !== `Bearer ${env.PROBE_TOKEN}`) return new Response('forbidden', { status: 403 });
		const url = new URL(request.url);
		try {
			if (request.method === 'GET' && url.pathname === '/bunny') {
				const marker = url.searchParams.get('marker') || '';
				if (!MARKER.test(marker)) return Response.json({ error: 'marker must be a run id' }, { status: 400 });
				return Response.json(await bunny(env, marker));
			}
			if (request.method === 'POST' && url.pathname === '/r2') {
				const { videoIds = [] } = await request.json();
				const ids = [...new Set(videoIds)].filter((id) => ID.test(id)).slice(0, 2000);
				return Response.json(await r2(env, ids));
			}
			return new Response('not found', { status: 404 });
		} catch (error) {
			return Response.json({ error: String(error?.message || error) }, { status: 502 });
		}
	},
};
