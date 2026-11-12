import type { MiddlewareHandler } from 'hono';
import { signBunnyUrlsInText } from '../lib/bunny-signing';
import { bunnyLibraries, type BunnyLibrariesEnv } from '../lib/bunny/libraries';
import { logger } from '../lib/logger';

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

	const env = c.env as BunnyLibrariesEnv;
	if (env.BUNNY_SIGN_URLS !== 'true') return;

	const response = c.res;
	const contentType = response.headers.get('content-type') || '';
	if (!response.ok || !contentType.includes('application/json')) return;

	try {
		const libraries = (await bunnyLibraries(env)).filter((l) => l.host);
		const original = await response.clone().text();
		let text = original;
		for (const library of libraries) {
			if (!library.tokenKey) {
				if (library.primary) logger.warn('[bunnySigning] BUNNY_SIGN_URLS is on but the token key is missing', { libraryId: library.libraryId });
				continue;
			}
			text = await signBunnyUrlsInText(text, library.host!, library.tokenKey);
		}
		if (text === original) return;

		const headers = new Headers(response.headers);
		headers.delete('content-length');
		c.res = new Response(text, { status: response.status, statusText: response.statusText, headers });
	} catch (error) {
		logger.error('[bunnySigning] Failed to sign Bunny URLs; returning unsigned response', { error });
	}
};
