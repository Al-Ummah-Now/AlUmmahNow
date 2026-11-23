/**
 * GET /api/me/features[?channelId=]  which user-facing features this caller sees
 * (shared-types features.ts, lib/features). Signed out: only the viewer-facing
 * ones. Web, Apple, Android and Desktop hide every entry point whose key is
 * not true. Admin switches reach it within 30 s (lib/features/switches.ts), so caches are short:
 * signed out `public, max-age=30` (the same for everyone), signed in revalidated every time. The
 * ETag is a hash of the body; a matching If-None-Match gets 304 (wiki AUN-FEATURES §5.3).
 */
import type { Context } from 'hono';
import { NO_FEATURES, USER_FEATURES_VERSION, type UserFeaturesResponse } from '@al-ummah/shared-types';
import { computeFeatures, type FeaturesEnv } from '../../lib/features';
import { logger } from '../../lib/logger';

const CHANNEL_ID = /^[A-Za-z0-9_-]{1,80}$/;

export async function handleUserFeatures(c: Context) {
	const userId = (c.get('userId') as string | undefined) ?? null;
	const roles = (c.get('auth') as { payload?: { roles?: string[] } } | undefined)?.payload?.roles ?? null;
	const raw = c.req.query('channelId');
	const channelId = raw && CHANNEL_ID.test(raw) ? raw : null;
	const headers = { 'Cache-Control': 'private, no-store', Vary: 'Authorization' };
	try {
		const features = await computeFeatures(c.env as FeaturesEnv, { userId, roles }, channelId);
		const body: UserFeaturesResponse = { success: true, version: USER_FEATURES_VERSION, features };
		const json = JSON.stringify(body);
		const etag = await bodyEtag(json);
		const cached = {
			'Cache-Control': userId ? 'private, max-age=0, must-revalidate' : 'public, max-age=30',
			Vary: 'Authorization',
			ETag: etag,
		};
		if (etagMatches(c.req.header('If-None-Match'), etag)) return new Response(null, { status: 304, headers: cached });
		return new Response(json, { status: 200, headers: { ...cached, 'Content-Type': 'application/json; charset=utf-8' } });
	} catch (error) {
		// Fail closed: everything hidden until the next read
		logger.error('[Features] Lookup failed; answering all hidden', { userId, channelId, error: error instanceof Error ? error.message : String(error) });
		return c.json({ success: true, version: USER_FEATURES_VERSION, features: NO_FEATURES }, 200, headers);
	}
}

/** A weak ETag over the body (the first 16 bytes of its SHA-256). */
export async function bodyEtag(json: string): Promise<string> {
	const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(json)));
	return `W/"${Array.from(digest.slice(0, 16), (b) => b.toString(16).padStart(2, '0')).join('')}"`;
}

/** If-None-Match against an ETag (weak comparison; `*` matches). */
export function etagMatches(header: string | undefined, etag: string): boolean {
	if (!header) return false;
	const bare = (tag: string) => tag.trim().replace(/^W\//, '');
	return header.split(',').some((tag) => tag.trim() === '*' || bare(tag) === bare(etag));
}
