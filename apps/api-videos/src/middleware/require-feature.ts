/**
 * The server feature gate (FEAT-2, wiki AUN-FEATURES §5.1): while a switch is off (or a switch it
 * needs is off, or FEATURES_FORCE_OFF names it) its routes answer 404 feature_off with the error
 * envelope, before validation. Applied from FEATURE_ROUTES (shared-types feature-routes.ts), never
 * by hand; an unreadable switch table lets the request through (the handler's own checks remain), except
 * on a route marked `failClosed`, which is refused.
 */
import type { Context, Hono, MiddlewareHandler } from 'hono';
import { featureGate, middlewareFeatureRoutes, type FeatureApp, type FeatureKey } from '@al-ummah/shared-types';
import { featureOff } from '../lib/features/off';
import { logger } from '../lib/logger';

export function requireFeature(key: FeatureKey, options: { failClosed?: boolean } = {}): MiddlewareHandler {
	return async (c, next) => {
		let gate;
		try {
			gate = await featureGate(c.env as never, key);
		} catch (error) {
			logger.warn('[FeatureGate] Switches unreadable', { key, refused: options.failClosed === true, error: error instanceof Error ? error.message : String(error) });
			return options.failClosed ? featureOff(c as Context, key) : next();
		}
		if (gate.on) return next();
		logger.debug('[FeatureGate] Refused', { key, reason: gate.reason, method: c.req.method, path: c.req.path });
		return featureOff(c as Context, key);
	};
}

/** Registers the gate on every route this worker owns in the map. */
export function applyFeatureGates(app: Hono<any>, worker: FeatureApp): void {
	for (const route of middlewareFeatureRoutes(worker)) app.on(route.method, route.path, requireFeature(route.key, { failClosed: route.failClosed }));
}
