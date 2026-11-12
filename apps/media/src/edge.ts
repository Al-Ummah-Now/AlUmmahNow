/**
 * /priv/<token>/<videoId>/<rev>/<file>: private and unlisted renditions.
 * A Worker route sends only /priv/* on the media host here; /pub/* is served by
 * the R2 custom domain and the Cache Rule with no Worker.
 *
 * The edge cache is keyed by object key, not by token, so all viewers of a
 * private video share one cached copy and a new token never misses the cache.
 */
import { mediaContentType, mediaCacheControl, parsePrivatePath, verifyMediaToken } from '@al-ummah/shared-types';
import { secret, type Env } from './env';

const CORS: Record<string, string> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, HEAD, OPTIONS',
	'access-control-allow-headers': 'range',
	'access-control-expose-headers': 'content-length, content-range, age, cf-cache-status, x-media-cache',
	'timing-allow-origin': '*',
};
const MAX_CACHEABLE = 512 * 1024 * 1024;

const text = (status: number, body: string) =>
	new Response(body, { status, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...CORS } });

export async function handlePrivate(request: Request, env: Env, ctx: ExecutionContext, cacheStore: Cache = caches.default): Promise<Response> {
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
	if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
	const url = new URL(request.url);
	const parsed = parsePrivatePath(url.pathname);
	if (!parsed) return text(404, 'Not found');
	const key = await secret(env.MEDIA_SIGN_KEY, 'MEDIA_SIGN_KEY');
	if (!(await verifyMediaToken(key, parsed.token, parsed.videoId, parsed.rev))) return text(403, 'Link expired');

	const objectKey = `priv/${parsed.videoId}/${parsed.rev}/${parsed.rest}`;
	const cacheKey = new Request(`https://${url.host}/__media/${objectKey}`, { method: 'GET', headers: request.headers.get('range') ? { range: request.headers.get('range')! } : {} });
	const hit = await cacheStore.match(cacheKey);
	if (hit) return withHeaders(hit, 'HIT', request.method);

	const range = request.headers.get('range');
	if (range) {
		const obj = await env.MEDIA_PRIVATE.get(objectKey, { range: request.headers });
		if (!obj) return text(404, 'Not found');
		return withHeaders(objectResponse(obj, parsed.rest, true), 'MISS', request.method);
	}
	const obj = await env.MEDIA_PRIVATE.get(objectKey);
	if (!obj) return text(404, 'Not found');
	const response = objectResponse(obj, parsed.rest, false);
	if (obj.size <= MAX_CACHEABLE) ctx.waitUntil(cacheStore.put(new Request(cacheKey.url), response.clone()));
	return withHeaders(response, 'MISS', request.method);
}

function objectResponse(obj: R2ObjectBody, file: string, ranged: boolean): Response {
	const headers = new Headers();
	headers.set('content-type', obj.httpMetadata?.contentType || mediaContentType(file));
	headers.set('cache-control', mediaCacheControl(file));
	headers.set('etag', obj.httpEtag);
	headers.set('accept-ranges', 'bytes');
	let status = 200;
	const r = obj.range as { offset?: number; length?: number } | undefined;
	if (ranged && r && (r.offset !== undefined || r.length !== undefined)) {
		const offset = r.offset ?? 0;
		const length = r.length ?? obj.size - offset;
		headers.set('content-range', `bytes ${offset}-${offset + length - 1}/${obj.size}`);
		headers.set('content-length', String(length));
		status = 206;
	} else {
		headers.set('content-length', String(obj.size));
	}
	return new Response(obj.body, { status, headers });
}

function withHeaders(res: Response, cache: 'HIT' | 'MISS', method: string): Response {
	const out = new Response(method === 'HEAD' ? null : res.body, res);
	for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
	out.headers.set('x-media-cache', cache);
	// Browsers may keep a private file for its token's life only
	out.headers.set('cache-control', 'private, max-age=3600');
	return out;
}
