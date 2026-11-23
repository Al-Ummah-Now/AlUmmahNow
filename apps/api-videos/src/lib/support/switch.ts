/**
 * The one seam between creator support and the AUN-FEATURES switch `creatorSupport` (wiki
 * AUN-MEMBERS §9.5, §9.7; AUN-FEATURES §2, §5.1).
 *
 * Owner decision 2026-11-22: support stays OFF in every environment until the organization exists
 * and the lawyer, PayGood, Wise and PayPal sign off. The switch defaults off, and the Features page
 * refuses to turn it on until `supportCanTurnOnHook` passes (admin-api feature-preconditions.ts).
 *
 * Fails closed: an unreadable switch table, or no search D1, reads as off.
 * Tests pass `override` to exercise the on path; production code never does.
 */
import { readFeatureSwitches, type SwitchesEnv } from '@al-ummah/shared-types';
import { logger } from '../logger';

export interface SupportSwitchState {
	on: boolean;
	reason: 'switched_off' | 'unreadable' | null;
	/** The supportPerks switch (MEM-D15 interlock: perks on hides the apps' P2P mode); unknown reads as on */
	perksOn: boolean;
}

export async function supportSwitch(env: unknown, override?: { on: boolean; perksOn?: boolean }): Promise<SupportSwitchState> {
	if (override) return { on: override.on, reason: override.on ? null : 'switched_off', perksOn: override.perksOn ?? true };
	const e = (env ?? {}) as SwitchesEnv;
	if (!e.SEARCH_DB) return { on: false, reason: 'unreadable', perksOn: true };
	try {
		const { effective } = await readFeatureSwitches(e);
		const perksOn = effective.supportPerks !== false;
		return effective.creatorSupport ? { on: true, reason: null, perksOn } : { on: false, reason: 'switched_off', perksOn };
	} catch (error) {
		logger.warn('[Support] Feature switches unreadable; support treated as off', { error: error instanceof Error ? error.message : String(error) });
		return { on: false, reason: 'unreadable', perksOn: true };
	}
}

export { supportReadiness, type SupportReadiness } from '@al-ummah/shared-types';
