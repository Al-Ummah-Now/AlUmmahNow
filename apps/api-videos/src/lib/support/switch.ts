/**
 * The one seam between creator support and the AUN-FEATURES switch `creatorSupport` (wiki
 * AUN-MEMBERS §9.5, §9.7; AUN-FEATURES §2, §5.1).
 *
 * Owner decision 2026-11-22: support stays OFF in every environment until the organisation exists
 * and the lawyer, PayGood, Wise and PayPal sign off. The shared registry (`feature-registry.ts`,
 * story FEAT-1) has not landed yet, so this answers OFF everywhere; when it lands, this module
 * reads `featureGate(env, 'creatorSupport')` and nothing else in support changes.
 *
 * Tests pass `override` to exercise the on path; production code never does.
 */

export interface SupportSwitchState {
	on: boolean;
	reason: 'switched_off' | 'registry_pending' | null;
}

export async function supportSwitch(_env: unknown, override?: { on: boolean }): Promise<SupportSwitchState> {
	if (override) return { on: override.on, reason: override.on ? null : 'switched_off' };
	return { on: false, reason: 'registry_pending' };
}

export { supportReadiness, type SupportReadiness } from '@al-ummah/shared-types';
