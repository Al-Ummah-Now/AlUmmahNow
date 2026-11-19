/**
 * A Mastodon instance's own character limit (#1593). Read from the instance (GET /api/v2/instance) when an account
 * connects and again when the cached value is a week old, cached in social_settings, and used by the sender and by
 * Studio's Post text preview through composePostText. Unknown → null, and the network default (500) applies.
 */
import { mastodonInstanceLimits } from './adapters/mastodon';
import { MASTODON_LIMIT_TTL_MS, readMastodonLimits, writeMastodonLimit, type SocialDbEnv } from './store';
import { logger } from '../logger';

export async function mastodonCharLimit(env: SocialDbEnv, instance: string | null | undefined, f: typeof fetch, now = Date.now()): Promise<number | null> {
	if (!instance) return null;
	const cached = (await readMastodonLimits(env, [instance])).get(instance);
	if (cached && now - cached.at < MASTODON_LIMIT_TTL_MS) return cached.maxChars;
	const fresh = await mastodonInstanceLimits(f, instance);
	if (!fresh.maxChars) return cached?.maxChars ?? null;
	await writeMastodonLimit(env, instance, fresh.maxChars, now).catch((error) => {
		logger.warn('[Social] Mastodon limit not cached', { instance, error: error instanceof Error ? error.message : String(error) });
	});
	return fresh.maxChars;
}
