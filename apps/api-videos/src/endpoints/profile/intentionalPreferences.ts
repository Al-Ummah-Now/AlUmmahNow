/**
 * The signed-in viewer's intentional-viewing preferences (lib/intentional-preferences.ts; wiki
 * Epic 21 §4 21.6). Gated by `intentionalViewing` (FEATURE_ROUTES).
 *
 * GET /api/profile/intentional  -> preferences
 * PUT /api/profile/intentional  { dailyLimitMinutes?, finiteLamahat? } -> preferences
 */
import { z } from 'zod';
import { addAuthToSchema } from '../../lib/openapi-auth';
import { AuthenticatedRoute, type AppContext } from '../../base';
import { logger } from '../../lib/logger';
import { DAILY_LIMIT_MAX, DAILY_LIMIT_MIN, getIntentionalPreferences, setIntentionalPreferences } from '../../lib/intentional-preferences';

const Preferences = z.object({
	dailyLimitMinutes: z.number().int().nullable().describe('null = no daily reminder'),
	finiteLamahat: z.boolean(),
	updatedAt: z.string().nullable(),
});
const Patch = z
	.object({
		dailyLimitMinutes: z.number().int().min(DAILY_LIMIT_MIN).max(DAILY_LIMIT_MAX).nullable().optional(),
		finiteLamahat: z.boolean().optional(),
	})
	.strict();

export class IntentionalPreferencesGet extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Profiles'],
			summary: "Get the current user's intentional-viewing preferences",
			responses: { '200': { description: 'Preferences', content: { 'application/json': { schema: Preferences } } }, '404': { description: 'feature_off' } },
		},
		'required',
	);

	async handle(c: AppContext) {
		c.header('Cache-Control', 'private, no-store');
		return c.json(await getIntentionalPreferences(c.env.profiles, this.getUserId(c)), 200);
	}
}

export class IntentionalPreferencesUpdate extends AuthenticatedRoute {
	schema = addAuthToSchema(
		{
			tags: ['Profiles'],
			summary: "Update the current user's intentional-viewing preferences",
			request: { body: { content: { 'application/json': { schema: Patch } } } },
			responses: {
				'200': { description: 'Saved preferences', content: { 'application/json': { schema: Preferences } } },
				'400': { description: 'Invalid request data' },
				'404': { description: 'feature_off' },
			},
		},
		'required',
	);

	async handle(c: AppContext) {
		const { body } = await this.getValidatedData<typeof this.schema>();
		const userId = this.getUserId(c);
		const saved = await setIntentionalPreferences(c.env.profiles, userId, (this.getAuth(c) as { email?: string }).email, body);
		logger.debug('[IntentionalPreferences] Saved', { userId });
		c.header('Cache-Control', 'private, no-store');
		return c.json(saved, 200);
	}
}
