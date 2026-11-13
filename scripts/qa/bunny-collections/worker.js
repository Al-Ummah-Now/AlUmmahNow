/**
 * Throwaway probe for orphaned Bunny Stream collections (#1085, #1086),
 * deployed and deleted by .github/workflows/bunny-orphan-collections.yml.
 *
 * Every channel (and every user, for user-level uploads) owns one collection
 * per library, recorded on its R2 record as `bunnyCollections: { [libraryId]:
 * collectionId }` (older records: `bunnyCollectionId`, library unknown). A
 * collection no channel or profile record refers to is an orphan.
 *
 *   GET  /collections?lib=<id>        every collection of a library: [guid, name, videoCount, totalSize]
 *   GET  /refs?bucket=<b>&cursor=<c>  collection ids referenced by up to 400 records of one bucket
 *   GET  /snapshot, PUT /snapshot     the last dry run's orphan ids (test target only)
 *   POST /delete {lib, ids}           delete collections (test target only, library 553336 only)
 *
 * The keys never leave the worker. The prod target binds no snapshot bucket
 * and sets READ_ONLY: it can only list.
 */
const API = 'https://video.bunnycdn.com';
/** The only library whose collections may ever be deleted: the QA/stage test library */
const TEST_LIBRARY = '553336';
const REFS_PER_CALL = 400;

async function secret(binding) {
	if (!binding) return '';
	return typeof binding === 'string' ? binding : await binding.get();
}

/** The API key of library `lib` (LIBRARY_<n>_KEY / LIBRARY_<n>_ID bindings, n = 1, 2) */
async function keyFor(env, lib) {
	for (const n of [1, 2]) {
		const id = String(await secret(env[`LIBRARY_${n}_ID`])).trim();
		if (id && id === String(lib)) return { id, key: await secret(env[`LIBRARY_${n}_KEY`]) };
	}
	return null;
}

async function collections(key, lib) {
	const out = [];
	for (let page = 1; page < 500; page++) {
		const r = await fetch(`${API}/library/${lib}/collections?page=${page}&itemsPerPage=100&orderBy=date`, { headers: { AccessKey: key, accept: 'application/json' } });
		if (!r.ok) throw new Error(`collections page ${page}: HTTP ${r.status}`);
		const body = await r.json();
		for (const c of body.items || []) out.push([c.guid, (c.name || '').slice(0, 60), c.videoCount ?? 0, c.totalSize ?? 0]);
		if (!body.items?.length || out.length >= (body.totalItems ?? 0)) break;
	}
	return out;
}

/** [libraryId | null, collectionId] pairs a record refers to */
function refsOf(record) {
	const out = [];
	if (!record || typeof record !== 'object') return out;
	const map = record.bunnyCollections && typeof record.bunnyCollections === 'object' ? record.bunnyCollections : {};
	for (const [lib, id] of Object.entries(map)) if (typeof id === 'string' && id) out.push([lib, id]);
	if (typeof record.bunnyCollectionId === 'string' && record.bunnyCollectionId) out.push([null, record.bunnyCollectionId]);
	return out;
}

async function refs(bucket, cursor) {
	const page = await bucket.list({ cursor: cursor || undefined, limit: REFS_PER_CALL });
	const out = [];
	let records = 0;
	for (let i = 0; i < page.objects.length; i += 50) {
		await Promise.all(page.objects.slice(i, i + 50).map(async (o) => {
			// Index entries and other non-JSON objects are skipped
			if (o.size > 2_000_000) return;
			const obj = await bucket.get(o.key);
			if (!obj) return;
			let r;
			try { r = await obj.json(); } catch { return; }
			// A soft-deleted record still owns its collections (restorable)
			records++;
			out.push(...refsOf(r));
		}));
	}
	return { refs: out, listed: page.objects.length, records, cursor: page.truncated ? page.cursor : null };
}

export default {
	async fetch(request, env) {
		const auth = request.headers.get('authorization') || '';
		const expected = await secret(env.PROBE_TOKEN);
		if (!expected || auth !== `Bearer ${expected}`) return new Response('forbidden', { status: 403 });
		const url = new URL(request.url);
		try {
			if (url.pathname === '/collections') {
				const k = await keyFor(env, url.searchParams.get('lib'));
				if (!k) return Response.json({ error: 'unknown library' }, { status: 400 });
				return Response.json({ lib: k.id, items: await collections(k.key, k.id) });
			}
			if (url.pathname === '/refs') {
				const name = url.searchParams.get('bucket') || '';
				const bucket = (env.REF_BUCKETS || '').split(',').includes(name) ? env[name] : null;
				if (!bucket) return Response.json({ error: 'unknown bucket' }, { status: 400 });
				return Response.json(await refs(bucket, url.searchParams.get('cursor')));
			}
			if (env.READ_ONLY === 'true') return new Response('read only', { status: 403 });
			if (url.pathname === '/snapshot' && env.SNAPSHOT) {
				const keyName = 'ops/bunny-orphan-collections.json';
				if (request.method === 'PUT') {
					await env.SNAPSHOT.put(keyName, await request.text(), { httpMetadata: { contentType: 'application/json' } });
					return Response.json({ ok: true });
				}
				const o = await env.SNAPSHOT.get(keyName);
				return o ? new Response(o.body, { headers: { 'content-type': 'application/json' } }) : Response.json(null);
			}
			if (url.pathname === '/delete' && request.method === 'POST') {
				const { lib, ids = [] } = await request.json();
				if (String(lib) !== TEST_LIBRARY) return Response.json({ error: `refusing library ${lib}: only the test library ${TEST_LIBRARY}` }, { status: 403 });
				const k = await keyFor(env, lib);
				if (!k) return Response.json({ error: 'test library not bound' }, { status: 400 });
				const results = { deleted: 0, gone: 0, failed: [] };
				for (let i = 0; i < ids.length; i += 10) {
					await Promise.all(ids.slice(i, i + 10).map(async (id) => {
						const r = await fetch(`${API}/library/${k.id}/collections/${encodeURIComponent(id)}`, { method: 'DELETE', headers: { AccessKey: k.key } });
						if (r.ok) results.deleted++;
						else if (r.status === 404) results.gone++;
						else results.failed.push({ id, http: r.status });
					}));
				}
				return Response.json(results);
			}
			return new Response('not found', { status: 404 });
		} catch (e) {
			return Response.json({ error: String(e?.message || e) }, { status: 500 });
		}
	},
};
