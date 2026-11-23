/**
 * The signed-in viewer's Islamic-experience preferences (lib/islamic-preferences.ts; wiki Epic 21
 * §5.1). Answers 404 `feature_off` unless at least one of prayer times, Qibla, the Hijri date or
 * Ramadan mode is on (FEATURE_ROUTES maps these routes to `prayerTimes`, enforced here).
 *
 * GET /api/profile/islamic  -> preferences
 * PUT /api/profile/islamic  { version, ...changes } -> preferences; 409 version_conflict with the stored ones
 */
import { z } from 'zod';
import { readFeatureSwitches, type FeatureKey } from '@al-ummah/shared-types';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { featureOff } from '../../lib/features';
import { apiError } from '../../lib/api-error';
import { logger } from '../../lib/logger';
import {
	ADJUSTMENT_MAX_MINUTES,
	CITY_ID_PATTERN,
	HIJRI_SHIFT_MAX_DAYS,
	PreferencesConflict,
	getIslamicPreferences,
	setIslamicPreferences,
} from '../../lib/islamic-preferences';

/** Any of these on makes the preferences reachable (each needs some of them) */
export const ISLAMIC_PREFERENCE_FEATURES: readonly FeatureKey[] = ['prayerTimes', 'qibla', 'hijriCalendar', 'ramadanMode'];

async function anyIslamicFeatureOn(c: AppContext): Promise<boolean> {
	try {
		const { effective } = await readFeatureSwitches(c.env as never);
		return ISLAMIC_PREFERENCE_FEATURES.some((key) => effective[key]);
	} catch (error) {
		logger.warn('[IslamicPreferences] Feature switches not read; treated as off', { error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}

const Adjustment = z.number().int().min(-ADJUSTMENT_MAX_MINUTES).max(ADJUSTMENT_MAX_MINUTES);
const Adjustments = z.object({
	fajr: Adjustment,
	sunrise: Adjustment,
	dhuhr: Adjustment,
	asr: Adjustment,
	maghrib: Adjustment,
	isha: Adjustment,
});
const Method = z.union([z.literal('auto'), z.number().int().min(0).max(99)]);

const Preferences = z.object({
	version: z.number().int().describe('Send it back with a change; a different stored version answers 409'),
	cityId: z.string().nullable().describe('Catalogue city id (GeoNames); the only location value that leaves the device'),
	calculationMethod: Method.describe("'auto' = the city's country default, else a provider method id"),
	asrMethod: z.enum(['standard', 'hanafi']),
	adjustmentsMinutes: Adjustments.describe('Applied on the device, never sent to the prayer API'),
	hijriEnabled: z.boolean(),
	hijriShiftDays: z.number().int().min(-HIJRI_SHIFT_MAX_DAYS).max(HIJRI_SHIFT_MAX_DAYS).describe('Applied on the device to the provider date'),
	ramadanMode: z.boolean(),
	jumuahReminder: z.boolean(),
	updatedAt: z.string().nullable(),
});

const Patch = z
	.object({
		version: z.number().int().min(0),
		cityId: z.string().regex(CITY_ID_PATTERN).nullable().optional(),
		calculationMethod: Method.optional(),
		asrMethod: z.enum(['standard', 'hanafi']).optional(),
		adjustmentsMinutes: Adjustments.partial().optional(),
		hijriEnabled: z.boolean().optional(),
		hijriShiftDays: z.number().int().min(-HIJRI_SHIFT_MAX_DAYS).max(HIJRI_SHIFT_MAX_DAYS).optional(),
		ramadanMode: z.boolean().optional(),
		jumuahReminder: z.boolean().optional(),
	})
	.strict();

export class IslamicPreferencesGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Profiles'],
			summary: "Get the current user's prayer, Qibla and Hijri preferences",
			responses: {
				'200': { description: 'Preferences', content: { 'application/json': { schema: Preferences } } },
				'404': { description: 'feature_off' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		if (!(await anyIslamicFeatureOn(c))) return featureOff(c, 'prayerTimes');
		c.header('Cache-Control', 'private, no-store');
		return c.json(await getIslamicPreferences(c.env.profiles, this.getUserId(c)), 200);
	}
}

export class IslamicPreferencesUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Profiles'],
			summary: "Update the current user's prayer, Qibla and Hijri preferences",
			description: 'Send the `version` you read with the fields to change. Exact coordinates are never accepted: only a catalogue city id.',
			request: { body: { content: { 'application/json': { schema: Patch } } } },
			responses: {
				'200': { description: 'Saved preferences', content: { 'application/json': { schema: Preferences } } },
				'400': { description: 'Invalid request data' },
				'404': { description: 'feature_off' },
				'409': { description: 'version_conflict: the stored preferences are returned in `current`' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		if (!(await anyIslamicFeatureOn(c))) return featureOff(c, 'prayerTimes');
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const email = (this.getAuth(c) as { email?: string }).email;
		const { version, ...patch } = body;
		c.header('Cache-Control', 'private, no-store');
		try {
			const saved = await setIslamicPreferences(c.env.profiles, userId, email, version, patch);
			logger.debug('[IslamicPreferences] Saved', { userId, version: saved.version });
			return c.json(saved, 200);
		} catch (error) {
			if (error instanceof PreferencesConflict) return apiError(c, 409, 'conflict', { error: 'version_conflict', current: error.current });
			throw error;
		}
	}
}
