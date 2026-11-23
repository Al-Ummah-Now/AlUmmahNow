/**
 * The 404 a gated API answers while its feature is off for the caller. The error envelope
 * (middleware/error-envelope.ts) adds the localized message, named after `feature` when given
 * (wiki AUN-FEATURES §5.2, decision O40).
 */
import type { Context } from 'hono';
import type { FeatureKey } from '@al-ummah/shared-types';
import { apiError } from '../api-error';

export const featureOff = (c: Context, feature?: FeatureKey) =>
	apiError(c, 404, 'feature_off', feature ? { feature } : undefined, { 'Cache-Control': 'private, no-store' });
