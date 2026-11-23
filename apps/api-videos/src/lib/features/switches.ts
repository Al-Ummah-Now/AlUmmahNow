/**
 * Feature switches in api-videos (FEAT-4, wiki AUN-FEATURES §5.3): storage is shared
 * (shared-types feature-switch-store.ts); this adds the overlay the old readers use, so every gate
 * that reads an old `enabled` field (captions settings, YouTube import, social, categorize
 * visibility, tier requests) follows the Features page switch once it has a row.
 */
import {
	DEFAULT_FEATURE_SWITCHES,
	FEATURE_KEYS,
	SwitchWriteError,
	effectiveSwitches,
	forcedOff,
	readSwitchRows,
	writeFeatureSwitch,
	type FeatureKey,
	type SwitchesEnv,
	type SwitchRow,
} from '@al-ummah/shared-types';
import { logger } from '../logger';

export { forgetFeatureSwitches, readFeatureSwitches, readSwitchRows } from '@al-ummah/shared-types';

/**
 * The value an old reader returns for its `enabled` field: the row when the switch has one, else
 * the old value; and off while a required switch is off or the switch is forced off. Required
 * switches (upload, creatorSupport) have no old setting, so rows and defaults decide them.
 * Never throws: an unreadable table keeps the old value.
 */
export async function overlaySwitch(env: SwitchesEnv, key: FeatureKey, legacyValue: boolean): Promise<boolean> {
	let rows: ReadonlyMap<FeatureKey, SwitchRow>;
	try {
		rows = await readSwitchRows(env);
	} catch (error) {
		logger.warn('[FeatureSwitches] Rows unreadable; old setting kept', { key, error: error instanceof Error ? error.message : String(error) });
		return legacyValue && !forcedOff(env).has(key);
	}
	const stored = { ...DEFAULT_FEATURE_SWITCHES };
	for (const k of FEATURE_KEYS) {
		const row = rows.get(k);
		if (row) stored[k] = row.enabled;
	}
	if (!rows.has(key)) stored[key] = legacyValue;
	return effectiveSwitches(stored)[key] && !forcedOff(env).has(key);
}


/**
 * An old settings page changed its own toggle: when the switch already has a row, move the row
 * too, so the old page keeps working until the Features page replaces it. With no row the old
 * setting still rules and nothing is written. Retries once on a concurrent change.
 */
export async function syncLegacySwitch(env: SwitchesEnv, key: FeatureKey, enabled: boolean, actorId: string, now = new Date().toISOString()): Promise<void> {
	for (let attempt = 0; attempt < 2; attempt++) {
		const row = (await readSwitchRows(env, { fresh: true })).get(key);
		if (!row || row.enabled === enabled) return;
		try {
			await writeFeatureSwitch(env, { key, enabled, expectedVersion: row.version, actorId, legacyPage: true, currentStored: row.enabled, now });
			return;
		} catch (error) {
			if (!(error instanceof SwitchWriteError && error.code === 'feature_changed') || attempt === 1) throw error;
		}
	}
}
