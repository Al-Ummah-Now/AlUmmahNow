/**
 * The 404 a gated API answers while its feature is off for the caller. The error envelope
 * (middleware/error-envelope.ts) adds the localized message, named after `feature` when given
 * (wiki AUN-FEATURES §5.2, decision O40).
 */
import type { Context } from 'hono';
import { FEATURE_OFF_BODY, type FeatureKey } from '@al-ummah/shared-types';

export const featureOff = (c: Context, feature?: FeatureKey) =>
	c.json(feature ? { ...FEATURE_OFF_BODY, feature } : FEATURE_OFF_BODY, 404, { 'Cache-Control': 'private, no-store' });
