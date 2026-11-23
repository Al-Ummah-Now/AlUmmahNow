/**
 * Server checks for creator support (wiki AUN-MEMBERS §9.5, MEM-5): `support` and `supportReceive`
 * in /api/me/features follow the creatorSupport switch, the owner decisions, the Countries page,
 * the channel's own setting and admin pause, the payee's state, MEM-D5 (who may receive), MEM-D15
 * (apps) and MEM-D23 (gifts before the payee is active). Real SQL; no network.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { writeFeatureSwitch } from '@al-ummah/shared-types';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, MemoryQueue } from './helpers';
import { computeFeatures, forgetFeatureCaches, type FeaturesEnv } from '../src/lib/features';
import { writeSupportApps, writeSupportPolicy } from '../src/lib/support/config';
import { receiverEligibility, supporterEligibility, supportFeatureKeys } from '../src/lib/support/eligibility';

const OWNER = 'usr_owner';
const VIEWER = 'usr_viewer';
const CH = 'ch_support';
const DECIDED = { primaryRail: 'test', fallbackRail: 'none', holdDays: 30, payoutThresholdUsdMinor: 2500, payoutDayOfMonth: 15, creatorMayRaiseThreshold: true, payoutFeeBearer: 'creatorFromPayout', negativeBalancePolicy: 'netAgainstFutureGifts', dormantPolicy: 'unclaimedPropertyRule', dormantReminderMonths: [3, 6, 12], collectBeforePayeeActive: false, batchApprovers: 2, adjustmentApprovers: 2, collectorFeePayer: 'creatorSupporterMayCover', amounts: { USD: { minimum: 300, presets: [500, 1000, 2500] } }, minSupporterAge: 18, minCreatorAge: 18, receiversRule: 'everyAdultOwner' };

async function setup(opts: { switchOn?: boolean; decided?: Record<string, unknown> | false; payee?: 'active' | 'pending' | 'hold' | 'none'; enabled?: boolean; apps?: Record<string, unknown> } = {}) {
	const db = new SqliteD1();
	const channels = new MemoryBucket();
	await channels.put(CH, JSON.stringify({ id: CH, userId: OWNER, members: [] }));
	const env = { SEARCH_DB: db, channels, channel_sections: new MemoryBucket(), channel_tabs: new MemoryBucket(), global_settings: new MemoryBucket(), queue: new MemoryQueue(), ENVIRONMENT: 'qa', SUPPORT_TEST_PROVIDERS: '1' } as unknown as FeaturesEnv;
	if (opts.switchOn !== false) await writeFeatureSwitch(env, { key: 'creatorSupport', enabled: true, expectedVersion: 0, actorId: 'usr_super', currentStored: false });
	if (opts.decided !== false) await writeSupportPolicy(db as never, { ...DECIDED, ...(opts.decided ?? {}) }, 'usr_fin', 0);
	if (opts.apps) await writeSupportApps(db as never, opts.apps, 'usr_fin', opts.decided !== false ? 1 : 0);
	if (opts.enabled !== false) await db.prepare("INSERT INTO support_settings (channel_id, enabled, updated_at, updated_by) VALUES (?, 1, 'now', ?)").bind(CH, OWNER).run();
	const payee = opts.payee ?? 'active';
	if (payee !== 'none') {
		await db
			.prepare("INSERT INTO support_payees (id, channel_id, owner_user_id, rail, mode, rail_payee_ref, country, status, tax_form, sanctions_status, created_at, updated_at) VALUES ('pe1', ?, ?, 'test', 'test', 'trpe_x', 'GB', ?, ?, ?, 'now', 'now')")
			.bind(CH, OWNER, payee === 'pending' ? 'pending' : 'active', payee === 'pending' ? 'none' : 'w8ben', payee === 'hold' ? 'hold' : 'clear')
			.run();
	}
	forgetFeatureCaches();
	const keys = async (userId: string | null, request: { country?: string | null; client?: string | null; storefront?: string | null } = {}, channelId: string | null = CH) => {
		const f = await computeFeatures(env, { userId, roles: [] }, channelId, request);
		return { support: f.support, supportReceive: f.supportReceive };
	};
	return { db, env, keys };
}

beforeEach(() => forgetFeatureCaches());
afterEach(() => forgetFeatureCaches());

describe('/api/me/features support keys', () => {
	it('everything is hidden while the switch is off, however ready the channel is', async () => {
		const t = await setup({ switchOn: false });
		assert.deepEqual(await t.keys(VIEWER), { support: false, supportReceive: false });
	});

	it('hidden while the owner decisions are open', async () => {
		const t = await setup({ decided: false });
		assert.deepEqual(await t.keys(VIEWER), { support: false, supportReceive: false });
	});

	it('a ready channel: a viewer may support it; its own team may not; signed-out viewers see it can receive', async () => {
		const t = await setup();
		assert.deepEqual(await t.keys(VIEWER, { country: 'GB' }), { support: true, supportReceive: true });
		assert.deepEqual(await t.keys(OWNER, { country: 'GB' }), { support: false, supportReceive: true });
		assert.deepEqual(await t.keys(null), { support: false, supportReceive: true });
		assert.deepEqual(await t.keys(VIEWER, { country: 'GB' }, null), { support: true, supportReceive: false });
	});

	it('the Countries page: a sanctioned supporter country hides support', async () => {
		const t = await setup();
		assert.equal((await t.keys(VIEWER, { country: 'IR' })).support, false);
	});

	it('MEM-D15: native apps see nothing until an admin gives their platform and storefront a mode', async () => {
		const IOS = 'aun-ios/1.0 (iOS 19)';
		const off = await setup();
		assert.equal((await off.keys(VIEWER, { client: IOS, storefront: 'GB' })).support, false, 'the default is hidden everywhere');
		assert.equal((await off.keys(VIEWER, { country: 'GB' })).support, true, 'the web is unaffected');
		const us = await setup({ apps: { platforms: { ios: true }, rules: [{ platform: 'ios', region: 'US', mode: 'external_browser_us_link', cadence: 'one_time_and_monthly' }] } });
		assert.equal((await us.keys(VIEWER, { client: IOS, storefront: 'US' })).support, true);
		assert.equal((await us.keys(VIEWER, { client: IOS, storefront: 'GB' })).support, false, 'no rule for GB');
		assert.equal((await us.keys(VIEWER, { client: IOS })).support, false, 'no storefront from the app');
		assert.equal((await us.keys(VIEWER, { client: 'aun-android/1.0 (Android 16)', storefront: 'US' })).support, false, 'Android is off');
		assert.equal((await us.keys(VIEWER, { client: 'aun-tv/1.0 (tvOS 19)', storefront: 'US' })).support, false, 'not an app platform');
	});

	it('MEM-D15 interlocks: P2P needs the whole gift to reach the creator (or the stores’ written OK)', async () => {
		const IOS = 'aun-ios/1.0 (iOS 19)';
		const rules = [{ platform: 'ios', region: 'ROW', mode: 'external_browser_p2p', cadence: 'one_time_only' }];
		// The decided policy lets the creator bear fees, so P2P stays hidden without the stores' confirmation
		assert.equal((await (await setup({ apps: { platforms: { ios: true }, rules } })).keys(VIEWER, { client: IOS, storefront: 'GB' })).support, false);
		const ok = await setup({ apps: { platforms: { ios: true }, rules, storeConfirmedProcessorFeeDeduction: true } });
		assert.equal((await ok.keys(VIEWER, { client: IOS, storefront: 'GB' })).support, true);
		const whole = await setup({ decided: { collectorFeePayer: 'supporterAlways', payoutFeeBearer: 'organization' }, apps: { platforms: { ios: true }, rules } });
		assert.equal((await whole.keys(VIEWER, { client: IOS, storefront: 'GB' })).support, true);
		const eu = await setup({ apps: { platforms: { ios: true }, rules: [{ platform: 'ios', region: 'EU_EEA', mode: 'external_browser_eu_entitled', cadence: 'one_time_only' }] } });
		assert.equal((await eu.keys(VIEWER, { client: IOS, storefront: 'FR' })).support, false, 'EU mode needs the attestation');
	});

	it('MEM-D23: no gifts before the payee is active unless the decision allows it; a screening hold always stops them', async () => {
		assert.equal((await (await setup({ payee: 'pending' })).keys(VIEWER)).supportReceive, false);
		assert.equal((await (await setup({ payee: 'none' })).keys(VIEWER)).supportReceive, false);
		assert.equal((await (await setup({ payee: 'pending', decided: { collectBeforePayeeActive: true } })).keys(VIEWER)).supportReceive, true);
		assert.equal((await (await setup({ payee: 'hold', decided: { collectBeforePayeeActive: true } })).keys(VIEWER)).supportReceive, false);
	});

	it('the channel’s own switch and an admin pause', async () => {
		assert.equal((await (await setup({ enabled: false })).keys(VIEWER)).supportReceive, false);
		const t = await setup();
		await t.db.prepare("UPDATE support_settings SET admin_paused = 1, admin_paused_reason = 'review'").run();
		assert.equal((await t.keys(VIEWER)).supportReceive, false);
	});

	it('an emergency stop hides everything', async () => {
		const t = await setup();
		await t.db.prepare("UPDATE support_config SET emergency_stop = 1 WHERE id = 'default'").run();
		assert.deepEqual(await t.keys(VIEWER), { support: false, supportReceive: false });
	});
});

describe('MEM-D5 and the plain checks', () => {
	it('tierCapability: only owners whose tier allows it receive', async () => {
		const t = await setup({ decided: { receiversRule: 'tierCapability' } });
		const channel = { channelId: CH, ownerId: OWNER };
		assert.deepEqual(await receiverEligibility(t.env as never, channel, async () => false), { ok: false, reason: 'tier_not_allowed' });
		assert.deepEqual(await receiverEligibility(t.env as never, channel, async () => true), { ok: true });
		assert.deepEqual(await supportFeatureKeys(t.env as never, { userId: VIEWER, country: 'GB', client: null }, channel, async () => true), { support: true, supportReceive: true });
	});

	it('names why: signed out, a missing channel, a blocked creator country', async () => {
		const t = await setup();
		assert.deepEqual(await supporterEligibility(t.env as never, { userId: null, country: null, client: null }), { ok: false, reason: 'signed_out' });
		assert.deepEqual(await receiverEligibility(t.env as never, { channelId: CH, ownerId: null }, async () => true), { ok: false, reason: 'channel_missing' });
		await t.db.prepare("INSERT INTO support_country_rules (country, supporters, creators, reason, changed_by, changed_at) VALUES ('GB', 'allowed', 'waitlist', 'legal_review', 'usr_admin', 'now')").run();
		assert.deepEqual(await receiverEligibility(t.env as never, { channelId: CH, ownerId: OWNER }, async () => true), { ok: false, reason: 'country_blocked' });
	});
});

describe('review fixes (cross-provider review of #1772)', () => {
	it('MEM-D5 tierCapability reads the real tier flag: off by default, on once the owner’s tier has it', async () => {
		const { saveTier, assignTier } = await import('../src/lib/creatorTiers');
		const t = await setup({ decided: { receiversRule: 'tierCapability' } });
		await saveTier(t.db as never, 'creator-plus', { name: 'Creator Plus', perHour: 5, perDay: 10, maxConcurrent: 2, maxChannels: 2 }, 'admin-1', { create: true });
		await assignTier(t.db as never, OWNER, 'creator-plus', 'admin-1');
		assert.equal((await t.keys(VIEWER)).supportReceive, false);
		await saveTier(t.db as never, 'creator-plus', { supportReceive: true }, 'admin-1');
		forgetFeatureCaches();
		assert.equal((await t.keys(VIEWER)).supportReceive, true);
	});

	it('MEM-D23 on: a payee with payouts held, or restricted, disabled or closed at the rail, never collects', async () => {
		for (const change of ['payouts_held = 1', "status = 'restricted'", "status = 'disabled'", "status = 'closed'"]) {
			const t = await setup({ payee: 'pending', decided: { collectBeforePayeeActive: true } });
			await t.db.prepare(`UPDATE support_payees SET ${change}`).run();
			assert.equal((await t.keys(VIEWER)).supportReceive, false, change);
		}
	});
});
