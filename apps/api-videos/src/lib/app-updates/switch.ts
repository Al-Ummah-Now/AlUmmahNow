/**
 * The `appUpdates` switch (wiki AUN-APP-UPDATES; AUN-FEATURES). Fails closed: an unreadable switch
 * table, or no search D1, reads as off, so no app is told about updates or held by a minimum.
 */
import { readFeatureSwitches, type SwitchesEnv } from '@al-ummah/shared-types';
import { logger } from '../logger';

export async function appUpdatesOn(env: unknown): Promise<boolean> {
	const e = (env ?? {}) as SwitchesEnv;
	if (!e.SEARCH_DB) return false;
	try {
		const { effective } = await readFeatureSwitches(e);
		return effective.appUpdates === true;
	} catch (error) {
		logger.warn('[AppUpdates] Feature switches unreadable; update notices treated as off', { error: error instanceof Error ? error.message : String(error) });
		return false;
	}
}
