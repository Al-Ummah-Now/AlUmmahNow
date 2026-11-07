import type { MiddlewareHandler } from 'hono';
import { getSecret } from '../lib/env-helpers';
import { signBunnyUrlsInText } from '../lib/bunny-signing';
import { logger } from '../lib/logger';

interface BunnySigningEnv {
	bunny_hostname?: string;
	/**
	 * Host whose URLs are signed, when it differs from bunny_hostname (the
	 * upload library). Prod: legacy library 400189 (vz-215a1ffd), where the
	 * existing videos live and token authentication is on.
	 */
	BUNNY_SIGN_HOSTNAME?: string;
	/** "true" once CDN token authentication is enabled on the Stream library */
	BUNNY_SIGN_URLS?: string;
	BUNNY_TOKEN_KEY?: unknown;
}

/**
 * Signs Bunny Stream URLs (playUrl, thumbnails, previews) in JSON responses so
 * they work with Bunny CDN token authentication. Stored records keep plain
 * URLs; tokens are short-lived and added per response.
 *
 * Off unless BUNNY_SIGN_URLS === "true": signed path URLs return 404 while
 * token authentication is disabled on the library. Fails open: on any error
 * the original response is returned.
 */
export const bunnySigningMiddleware: MiddlewareHandler = async (c, next) => {
	await next();

	const env = c.env as BunnySigningEnv;
	const signHost = env.BUNNY_SIGN_HOSTNAME || env.bunny_hostname;
	if (env.BUNNY_SIGN_URLS !== 'true' || !signHost) return;

	const response = c.res;
	const contentType = response.headers.get('content-type') || '';
	if (!response.ok || !contentType.includes('application/json')) return;

	try {
		const key = await getSecret(env.BUNNY_TOKEN_KEY, 'BUNNY_TOKEN_KEY');
		if (!key) {
			logger.warn('[bunnySigning] BUNNY_SIGN_URLS is on but BUNNY_TOKEN_KEY is missing');
			return;
		}
		const text = await response.clone().text();
		const signed = await signBunnyUrlsInText(text, signHost, key);
		if (signed === text) return;

		const headers = new Headers(response.headers);
		headers.delete('content-length');
		c.res = new Response(signed, { status: response.status, statusText: response.statusText, headers });
	} catch (error) {
		logger.error('[bunnySigning] Failed to sign Bunny URLs; returning unsigned response', { error });
	}
};
