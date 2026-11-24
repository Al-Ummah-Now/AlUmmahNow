/**
 * Media Worker edge handlers:
 * - `/priv/<token>/<videoId>/<rev>/<file>`: private and unlisted renditions (cached by object key).
 * - `/dl/<videoId>/<rev>/<filename>`: public R2 `video.mp4` attachment helper for Web Download
 *   (Epic 14, E14-D6). No URL signing (public files are public per E14-D1), no Cloudflare edge
 *   cache (`Cache-Control: private, no-store` so deleting the R2 object immediately stops all
 *   `:filename` variants), and full `GET`/`HEAD`/`Range`/`206`/`416`/`If-Range`/`ETag` support.
 *
 * `/pub/*` is served directly by the R2 custom domain + Cache Rule with no Worker.
 */
import {
	buildContentDispositionAttachment,
	MEDIA_MP4,
	mediaCacheControl,
	mediaContentType,
	parseDownloadPath,
	parsePrivatePath,
	verifyMediaFileToken,
	verifyMediaToken,
} from '@al-ummah/shared-types';
import { secret, type Env } from './env';

const CORS: Record<string, string> = {
	'access-control-allow-origin': '*',
	'access-control-allow-methods': 'GET, HEAD, OPTIONS',
	'access-control-allow-headers': 'range, if-range',
	'access-control-expose-headers': 'content-length, content-range, content-disposition, etag, accept-ranges, age, cf-cache-status, x-media-cache',
	'timing-allow-origin': '*',
};
const MAX_CACHEABLE = 512 * 1024 * 1024;

const text = (status: number, body: string, extraHeaders: Record<string, string> = {}) =>
	new Response(body, {
		status,
		headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store', ...CORS, ...extraHeaders },
	});

type ParsedByteRange =
	| { kind: 'ok'; start: number; end: number }
	| { kind: 'unsatisfiable' }
	| { kind: 'ignore' };

/**
 * Parse a single RFC 9110 `bytes=...` range against `size`.
 * - Non-`bytes` units, multi-range headers (`bytes=0-1,5-6`), or syntactically malformed headers
 *   return `'ignore'` so the server ignores `Range` and returns a full `200 OK` per RFC 9110 §14.1.2.
 * - Syntactically valid single `bytes=` ranges that cannot be satisfied return `'unsatisfiable'` (`416`).
 */
function parseByteRange(header: string, size: number): ParsedByteRange {
	const trimmed = header.trim();
	if (!/^bytes=/i.test(trimmed)) return { kind: 'ignore' };
	const spec = trimmed.slice('bytes='.length).trim();
	if (!spec || spec.includes(',')) return { kind: 'ignore' };
	const m = /^(\d*)-(\d*)$/.exec(spec);
	if (!m) return { kind: 'ignore' };
	const [, rawStart, rawEnd] = m;
	if (rawStart === '' && rawEnd === '') return { kind: 'ignore' };
	if (size <= 0) return { kind: 'unsatisfiable' };
	if (rawStart === '') {
		// Suffix byte range: bytes=-<N>
		const suffix = Number(rawEnd);
		if (!Number.isSafeInteger(suffix) || suffix <= 0) return { kind: 'unsatisfiable' };
		const length = Math.min(suffix, size);
		return { kind: 'ok', start: size - length, end: size - 1 };
	}
	const start = Number(rawStart);
	if (!Number.isSafeInteger(start) || start < 0 || start >= size) return { kind: 'unsatisfiable' };
	if (rawEnd === '') return { kind: 'ok', start, end: size - 1 };
	const end = Number(rawEnd);
	if (!Number.isSafeInteger(end) || end < start) return { kind: 'unsatisfiable' };
	return { kind: 'ok', start, end: Math.min(end, size - 1) };
}

/**
 * RFC 9110 §13.1.5 strong comparison for `If-Range` against `ETag`.
 * Weak ETags (`W/...`) never match `If-Range`; HTTP-date values are treated as non-matching if they
 * do not equal the strong ETag (forcing a safe full `200 OK` fallback).
 */
function ifRangeMatchesEtag(ifRange: string, etag: string): boolean {
	const candidate = ifRange.trim();
	const current = etag.trim();
	if (!candidate || !current) return false;
	if (candidate.startsWith('W/') || current.startsWith('W/')) return false;
	return candidate === current;
}

export async function handlePrivate(request: Request, env: Env, ctx: ExecutionContext, cacheStore: Cache = caches.default): Promise<Response> {
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
	if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');
	const url = new URL(request.url);
	const parsed = parsePrivatePath(url.pathname);
	if (!parsed) return text(404, 'Not found');
	const key = await secret(env.MEDIA_SIGN_KEY, 'MEDIA_SIGN_KEY');
	// A folder token (playback) opens the rendition; a file token (a frame on a card) only its own file
	const allowed = parsed.token.startsWith('f')
		? await verifyMediaFileToken(key, parsed.token, parsed.videoId, parsed.rev, parsed.rest)
		: await verifyMediaToken(key, parsed.token, parsed.videoId, parsed.rev);
	if (!allowed) return text(403, 'Link expired');

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

/**
 * Web Download attachment route: `GET` / `HEAD /dl/:videoId/:rev/:filename`.
 * Reads ONLY `pub/<videoId>/<rev>/video.mp4` from the public `MEDIA` bucket, never `MEDIA_PRIVATE`.
 */
export async function handleDownload(request: Request, env: Env): Promise<Response> {
	if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: { ...CORS, 'access-control-max-age': '86400' } });
	if (request.method !== 'GET' && request.method !== 'HEAD') return text(405, 'Method not allowed');

	const url = new URL(request.url);
	const parsed = parseDownloadPath(url.pathname);
	if (!parsed) return text(404, 'Not found');

	const objectKey = `pub/${parsed.videoId}/${parsed.rev}/${MEDIA_MP4}`;
	const disposition = buildContentDispositionAttachment(parsed.filename, parsed.videoId);
	const rangeHeader = request.headers.get('range');
	const ifRange = request.headers.get('if-range');
	const isHead = request.method === 'HEAD';

	const baseDlHeaders = (etag: string, contentType: string): Headers => {
		const h = new Headers();
		for (const [k, v] of Object.entries(CORS)) h.set(k, v);
		h.set('content-type', contentType);
		h.set('content-disposition', disposition);
		h.set('cache-control', 'private, no-store');
		h.set('accept-ranges', 'bytes');
		h.set('etag', etag);
		return h;
	};

	// For HEAD or any Range request, inspect object metadata first so we can validate ETag / If-Range / 416 accurately.
	if (isHead || rangeHeader) {
		const meta = typeof env.MEDIA.head === 'function' ? await env.MEDIA.head(objectKey) : await env.MEDIA.get(objectKey);
		if (!meta) return text(404, 'Not found');
		if ('body' in meta && meta.body && typeof (meta.body as ReadableStream).cancel === 'function') {
			await (meta.body as ReadableStream).cancel().catch(() => {});
		}

		const contentType = meta.httpMetadata?.contentType || 'video/mp4';
		const applyRange = !!rangeHeader && (!ifRange || ifRangeMatchesEtag(ifRange, meta.httpEtag));

		if (applyRange) {
			const parsedRange = parseByteRange(rangeHeader!, meta.size);
			if (parsedRange.kind === 'unsatisfiable') {
				const h = baseDlHeaders(meta.httpEtag, contentType);
				h.set('content-range', `bytes */${meta.size}`);
				h.set('content-length', '0');
				return new Response(null, { status: 416, headers: h });
			}
			if (parsedRange.kind === 'ok') {
				const length = parsedRange.end - parsedRange.start + 1;
				if (isHead) {
					const h = baseDlHeaders(meta.httpEtag, contentType);
					h.set('content-range', `bytes ${parsedRange.start}-${parsedRange.end}/${meta.size}`);
					h.set('content-length', String(length));
					return new Response(null, { status: 206, headers: h });
				}
				const rangedObj = await env.MEDIA.get(objectKey, { range: { offset: parsedRange.start, length } });
				if (!rangedObj) return text(404, 'Not found');
				return applyDownloadHeaders(objectResponse(rangedObj, MEDIA_MP4, true, { start: parsedRange.start, end: parsedRange.end }), disposition, false);
			}
			// parsedRange.kind === 'ignore': fall through to full 200 OK per RFC 9110
		}

		if (isHead) {
			const h = baseDlHeaders(meta.httpEtag, contentType);
			h.set('content-length', String(meta.size));
			return new Response(null, { status: 200, headers: h });
		}
	}

	const obj = await env.MEDIA.get(objectKey);
	if (!obj) return text(404, 'Not found');
	return applyDownloadHeaders(objectResponse(obj, MEDIA_MP4, false), disposition, isHead);
}

function objectResponse(
	obj: R2ObjectBody,
	file: string,
	ranged: boolean,
	explicitRange?: { start: number; end: number },
): Response {
	const headers = new Headers();
	headers.set('content-type', obj.httpMetadata?.contentType || mediaContentType(file));
	headers.set('cache-control', mediaCacheControl(file));
	headers.set('etag', obj.httpEtag);
	headers.set('accept-ranges', 'bytes');
	let status = 200;
	const r = obj.range as { offset?: number; length?: number } | undefined;
	if (ranged && explicitRange) {
		const length = explicitRange.end - explicitRange.start + 1;
		headers.set('content-range', `bytes ${explicitRange.start}-${explicitRange.end}/${obj.size}`);
		headers.set('content-length', String(length));
		status = 206;
	} else if (ranged && r && (r.offset !== undefined || r.length !== undefined)) {
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

function applyDownloadHeaders(res: Response, disposition: string, head: boolean): Response {
	const out = new Response(head ? null : res.body, res);
	for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
	out.headers.set('content-disposition', disposition);
	// No edge cache: deleting the R2 object is the single control point across all :filename variants.
	out.headers.set('cache-control', 'private, no-store');
	return out;
}

function withHeaders(res: Response, cache: 'HIT' | 'MISS', method: string): Response {
	const out = new Response(method === 'HEAD' ? null : res.body, res);
	for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v);
	out.headers.set('x-media-cache', cache);
	// Browsers may keep a private file for its token's life only
	out.headers.set('cache-control', 'private, max-age=3600');
	return out;
}
