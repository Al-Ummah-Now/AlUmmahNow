/**
 * GET /api/me/features[?channelId=]  which user-facing features this caller sees
 * (shared-types features.ts, lib/features). Signed out: only the viewer-facing
 * ones. Web, Apple, Android and Desktop hide every entry point whose key is
 * not true. Never cached: tiers and admin switches change without a sign-in.
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
		return c.json(body, 200, headers);
	} catch (error) {
		// Fail closed: everything hidden until the next read
		logger.error('[Features] Lookup failed; answering all hidden', { userId, channelId, error: error instanceof Error ? error.message : String(error) });
		return c.json({ success: true, version: USER_FEATURES_VERSION, features: NO_FEATURES }, 200, headers);
	}
}
