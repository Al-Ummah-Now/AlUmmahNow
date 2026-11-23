/**
 * Server checks for creator support (wiki AUN-MEMBERS §9.5, §4.3, §8; MEM-5, Linear AUN-617).
 *
 * Two answers, used by GET /api/me/features (keys `support` and `supportReceive`) and by every
 * support API (checkout, MEM-7), so a hidden button and its API always agree:
 *
 * - supporter: may this signed-in person support creators from here? The owner decisions the
 *   support sheet needs (MEM-D3 card fee, D4 minimum, D9 ages) are recorded; no emergency stop; a
 *   collector exists here; the person's country isn't blocked for supporters (Countries page);
 *   and a native app (X-AUN-Client) only where the MEM-D15 app settings give its platform and
 *   storefront a mode other than hidden (shared-types support-apps.ts, with its interlocks).
 * - receiver: may this channel receive? MEM-D5 (who may receive), MEM-D17 (rail) and MEM-D23
 *   (gifts before the payee is active) are recorded; the channel exists and isn't suspended; the
 *   owner switched support on and no admin paused it; the payee is active, clear of screening and
 *   has a tax form on file (or MEM-D23 says gifts may wait for it); the payee's country isn't
 *   blocked for creators; and under MEM-D5 'tierCapability' the owner's tier allows it.
 *
 * The `creatorSupport` switch is checked by the caller (computeFeatures ANDs it in; the APIs call
 * `supportSwitch` first), so nothing here runs while support is off. Every read is keyed.
 */
import { type AppSupportDecision, appPlatformOfOs, appSupportMode, parseClientHeader, type SearchDb, type SupportPolicy } from '@al-ummah/shared-types';
import { collectorFor, type SupportAdapterEnv } from './adapters';
import { readSupportConfig, type SupportConfig } from './config';

export type SupporterRefusal = 'signed_out' | 'decisions_open' | 'emergency_stop' | 'no_collector' | 'country_blocked' | 'app_not_allowed';
export type ReceiverRefusal = 'decisions_open' | 'emergency_stop' | 'channel_missing' | 'channel_off' | 'channel_paused' | 'payee_not_ready' | 'country_blocked' | 'tier_not_allowed' | 'self_support';

export type Eligibility<R> = { ok: true } | { ok: false; reason: R };

export interface SupportRequest {
	userId: string | null;
	/** The request's country (Cloudflare's cf.country), the first filter before the collector's billing country */
	country: string | null;
	/** Native apps send X-AUN-Client; the web sends none */
	client: string | null;
	/** X-AUN-Storefront: the app store's storefront country (MEM-D15; stores apply rules by storefront) */
	storefront?: string | null;
}

export interface ReceiverChannel {
	channelId: string;
	ownerId: string | null;
	deleted?: boolean;
	suspended?: boolean;
	/** The caller's role on the channel: the team can't support its own channel */
	callerRole?: string | null;
}

export interface EligibilityEnv extends SupportAdapterEnv {
	SEARCH_DB?: SearchDb;
}

/** The owner's tier flag (MEM-D5 'tierCapability'); injected so this module stays free of tier storage. */
export type OwnerTierAllows = (ownerId: string) => Promise<boolean>;

const SUPPORTER_DECISIONS: (keyof SupportPolicy)[] = ['collectorFeePayer', 'amounts', 'minSupporterAge'];
const RECEIVER_DECISIONS: (keyof SupportPolicy)[] = ['receiversRule', 'primaryRail', 'fallbackRail', 'collectBeforePayeeActive', 'minCreatorAge'];

/**
 * MEM-D15: what a native app may show; null for the web. An app the server can't place on a
 * platform gets hidden, like an app with no rule.
 */
export function appDecisionFor(c: SupportConfig, req: SupportRequest): AppSupportDecision | null {
	if (!req.client) return null;
	const platform = appPlatformOfOs(parseClientHeader(req.client)?.os);
	if (!platform) return { mode: 'hidden', cadence: 'one_time_only', hiddenBecause: 'platform_off' };
	return appSupportMode({ settings: c.apps, platform, storefront: req.storefront ?? null, policy: c.policy });
}

const open = (p: SupportPolicy, fields: (keyof SupportPolicy)[]) => fields.some((f) => p[f] === null);

async function countryRule(db: SearchDb, country: string | null): Promise<{ supporters: string; creators: string } | null> {
	if (!country || !/^[A-Z]{2}$/.test(country)) return null;
	return db.prepare('SELECT supporters, creators FROM support_country_rules WHERE country = ?').bind(country).first<{ supporters: string; creators: string }>();
}

export async function supporterEligibility(env: EligibilityEnv, req: SupportRequest, config?: SupportConfig): Promise<Eligibility<SupporterRefusal>> {
	if (!req.userId) return { ok: false, reason: 'signed_out' };
	const db = env.SEARCH_DB!;
	const c = config ?? (await readSupportConfig(db));
	if (open(c.policy, SUPPORTER_DECISIONS)) return { ok: false, reason: 'decisions_open' };
	if (c.emergencyStop) return { ok: false, reason: 'emergency_stop' };
	if (!collectorFor(env, c.collector)) return { ok: false, reason: 'no_collector' };
	const app = appDecisionFor(c, req);
	if (app && app.mode === 'hidden') return { ok: false, reason: 'app_not_allowed' };
	const rule = await countryRule(db, req.country);
	if (rule?.supporters === 'blocked') return { ok: false, reason: 'country_blocked' };
	return { ok: true };
}

export async function receiverEligibility(env: EligibilityEnv, channel: ReceiverChannel, ownerTierAllows: OwnerTierAllows, config?: SupportConfig): Promise<Eligibility<ReceiverRefusal>> {
	const db = env.SEARCH_DB!;
	const c = config ?? (await readSupportConfig(db));
	if (open(c.policy, RECEIVER_DECISIONS)) return { ok: false, reason: 'decisions_open' };
	if (c.emergencyStop) return { ok: false, reason: 'emergency_stop' };
	if (!channel.ownerId || channel.deleted || channel.suspended) return { ok: false, reason: 'channel_missing' };
	const settings = await db.prepare('SELECT enabled, admin_paused FROM support_settings WHERE channel_id = ?').bind(channel.channelId).first<{ enabled: number; admin_paused: number }>();
	if (!settings || settings.enabled !== 1) return { ok: false, reason: 'channel_off' };
	if (settings.admin_paused === 1) return { ok: false, reason: 'channel_paused' };
	const payee = await db
		.prepare('SELECT status, tax_form, sanctions_status, payouts_held, country FROM support_payees WHERE channel_id = ? AND mode = ? ORDER BY CASE rail WHEN ? THEN 0 WHEN ? THEN 1 ELSE 2 END, updated_at DESC LIMIT 1')
		.bind(channel.channelId, c.mode, c.policy.primaryRail ?? '', c.policy.fallbackRail === 'none' ? '' : (c.policy.fallbackRail ?? ''))
		.first<{ status: string; tax_form: string; sanctions_status: string; payouts_held: number; country: string | null }>();
	const payeeReady = !!payee && payee.status === 'active' && payee.tax_form !== 'none' && payee.sanctions_status === 'clear' && payee.payouts_held === 0;
	// MEM-D23: without an active payee, gifts are collected only when the decision allows it
	if (!payeeReady && c.policy.collectBeforePayeeActive !== true) return { ok: false, reason: 'payee_not_ready' };
	// Whatever MEM-D23 says, a payee the rail or an admin stopped never collects: a screening hold, held
	// payouts, or a payee restricted, disabled or closed at the rail
	if (payee && (payee.sanctions_status === 'hold' || payee.payouts_held === 1 || payee.status === 'restricted' || payee.status === 'disabled' || payee.status === 'closed')) return { ok: false, reason: 'payee_not_ready' };
	const rule = await countryRule(db, payee?.country ?? null);
	if (rule && rule.creators !== 'allowed') return { ok: false, reason: 'country_blocked' };
	if (c.policy.receiversRule === 'tierCapability' && !(await ownerTierAllows(channel.ownerId))) return { ok: false, reason: 'tier_not_allowed' };
	return { ok: true };
}

/**
 * The `/api/me/features` keys. `support` without a channel: the person may support creators from
 * here. With a channel: they may support THAT channel (it receives, and they aren't on its team).
 */
export async function supportFeatureKeys(env: EligibilityEnv, req: SupportRequest, channel: ReceiverChannel | null, ownerTierAllows: OwnerTierAllows): Promise<{ support: boolean; supportReceive: boolean }> {
	if (!env.SEARCH_DB) return { support: false, supportReceive: false };
	const config = await readSupportConfig(env.SEARCH_DB);
	const [supporter, receiver] = await Promise.all([
		supporterEligibility(env, req, config),
		channel ? receiverEligibility(env, channel, ownerTierAllows, config) : Promise.resolve({ ok: false as const, reason: 'channel_missing' as const }),
	]);
	const onTeam = !!channel && (!!channel.callerRole || (!!req.userId && req.userId === channel.ownerId));
	return {
		support: supporter.ok && (!channel || (receiver.ok && !onTeam)),
		supportReceive: receiver.ok,
	};
}
