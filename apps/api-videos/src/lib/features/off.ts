/** The 404 a gated API answers while its feature is off for the caller (no user-facing text; shared-types features.ts). */
import type { Context } from 'hono';
import { FEATURE_OFF_BODY } from '@al-ummah/shared-types';

export const featureOff = (c: Context) => c.json(FEATURE_OFF_BODY, 404, { 'Cache-Control': 'private, no-store' });
