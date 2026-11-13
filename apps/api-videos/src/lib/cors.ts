/**
 * Which browser origins may call this API (no credentials; Bearer tokens only).
 *
 * - Every route: the environment's CORS_ORIGINS (wrangler vars; the release check
 *   scripts/release/apps.ts pins the stage and production lists), or the local
 *   dev defaults when it is unset. The www sites of every environment are listed there.
 * - The public play routes for the www timeline (GET /api/videos/:id/play, GET /api/shorts)
 *   also accept the www dev servers (localhost:4321 and :4331) outside production,
 *   so www can be developed against QA and stage. Never any other origin.
 */

export const DEFAULT_CORS_ORIGINS = [
	'http://localhost:3000',
	'http://localhost:3001',
	'http://localhost:3090',
	'http://127.0.0.1:3000',
	'http://127.0.0.1:3001',
	'http://127.0.0.1:3086',
	'http://127.0.0.1:3090',
];

/** The www (Astro) dev servers. */
export const WWW_DEV_ORIGINS = ['http://localhost:4321', 'http://localhost:4331'];

/** Routes www reads anonymously (after /api/v1 → /api rewriting). */
const PUBLIC_PLAY_PATHS = [/^\/api\/videos\/[^/]+\/play\/?$/, /^\/api\/shorts\/?$/];

export interface CorsEnv {
	CORS_ORIGINS?: string;
	ENVIRONMENT?: string;
}

export function isPublicPlayPath(path: string): boolean {
	return PUBLIC_PLAY_PATHS.some((p) => p.test(path));
}

export function isAllowedOrigin(origin: string, env: CorsEnv | undefined, request?: { path: string; method: string }): boolean {
	if (!origin) return false;
	const listed = env?.CORS_ORIGINS?.split(',').map((o) => o.trim()).filter(Boolean) ?? [];
	if ((listed.length ? listed : DEFAULT_CORS_ORIGINS).includes(origin)) return true;
	if (!request || env?.ENVIRONMENT === 'production' || !WWW_DEV_ORIGINS.includes(origin)) return false;
	return ['GET', 'HEAD', 'OPTIONS'].includes(request.method.toUpperCase()) && isPublicPlayPath(request.path);
}
