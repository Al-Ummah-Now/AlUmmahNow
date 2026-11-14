import type { MiddlewareHandler } from 'hono';
import { signBunnyUrlsInText } from '../lib/bunny-signing';
import { absoluteImageUrlsInText } from '../lib/image-urls';
import { bunnyLibraries, type BunnyLibrariesEnv } from '../lib/bunny/libraries';
import { logger } from '../lib/logger';
import { videoIdForRef } from '../lib/media/refs';
import { signMediaFramesInText } from '../lib/media/frame-signing';
import { getSecret } from '../lib/env-helpers';

/**
 * A new video's Bunny GUID → our id (lib/media/refs.ts). A mapping never changes once written, so
 * hits stay for the isolate's life; misses (legacy GUIDs are their own id) expire, in case the
 * row lands after a first lookup. Bounded: the oldest entry goes first.
 */
const OWNER_CACHE_MAX = 5000;
const MISS_TTL_MS = 5 * 60 * 1000;
const ownerCache = new Map<string, { id: string | null; at: number }>();

function ownerResolver(env: { SEARCH_DB?: D1Database }): ((guid: string) => Promise<string | null>) | undefined {
	if (!env.SEARCH_DB) return undefined;
	return async (guid) => {
		const hit = ownerCache.get(guid);
		if (hit && (hit.id || Date.now() - hit.at < MISS_TTL_MS)) return hit.id;
		const id = await videoIdForRef(env, 'bunny', guid);
		if (ownerCache.size >= OWNER_CACHE_MAX) ownerCache.delete(ownerCache.keys().next().value!);
		ownerCache.set(guid, { id: id === guid ? null : id, at: Date.now() });
		return id === guid ? null : id;
	};
}

/** For tests */
export function clearOwnerCache(): void {
	ownerCache.clear();
}

/**
 * Signs Bunny Stream URLs (playUrl, thumbnails, previews) in JSON responses so
 * they work with Bunny CDN token authentication. Stored records keep plain
 * URLs; tokens are short-lived and added per response.
 *
 * Every configured library is signed with its own token key (lib/bunny/libraries.ts):
 * production signs the primary library 498994 and the legacy library 400189,
 * each only on its own CDN host.
 *
 * Off unless BUNNY_SIGN_URLS === "true": signed path URLs return 404 while
 * token authentication is disabled on the library. Fails open: on any error
 * the original response is returned.
 */
export const bunnySigningMiddleware: MiddlewareHandler = async (c, next) => {
	await next();

	const env = c.env as BunnyLibrariesEnv & { SEARCH_DB?: D1Database; MEDIA_PUBLIC_HOST?: string; MEDIA_SIGN_KEY?: unknown };
	const response = c.res;
	const contentType = response.headers.get('content-type') || '';
	if (!response.ok || !contentType.includes('application/json')) return;

	try {
		const original = await response.clone().text();
		// Legacy scheme-less image URLs become loadable https:// URLs (lib/image-urls.ts), with or without signing
		let text = absoluteImageUrlsInText(original);
		const libraries = env.BUNNY_SIGN_URLS === 'true' ? (await bunnyLibraries(env)).filter((l) => l.host) : [];
		const resolveOwner = ownerResolver(env);
		for (const library of libraries) {
			if (!library.tokenKey) {
				if (library.primary) logger.warn('[bunnySigning] BUNNY_SIGN_URLS is on but the token key is missing', { libraryId: library.libraryId });
				continue;
			}
			text = await signBunnyUrlsInText(text, library.host!, library.tokenKey, undefined, resolveOwner);
		}
		// Private R2 frames of videos whose only copy is on R2 (lib/media/frame-signing.ts)
		if (env.MEDIA_PUBLIC_HOST && text.includes(`${env.MEDIA_PUBLIC_HOST}/priv/`)) {
			const key = await getSecret(env.MEDIA_SIGN_KEY as never, 'MEDIA_SIGN_KEY').catch(() => '');
			if (key) text = await signMediaFramesInText(text, env.MEDIA_PUBLIC_HOST, key);
		}
		if (text === original) return;

		const headers = new Headers(response.headers);
		headers.delete('content-length');
		c.res = new Response(text, { status: response.status, statusText: response.statusText, headers });
	} catch (error) {
		logger.error('[bunnySigning] Failed to sign Bunny URLs; returning unsigned response', { error });
	}
};
