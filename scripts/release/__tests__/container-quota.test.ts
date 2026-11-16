import { test } from 'node:test';
import assert from 'node:assert/strict';
import { appOf, checkQuota, INSTANCE_VCPU, plannedMediaApps, type AccountApp, type PlannedApp } from '../container-quota.ts';

const planned: PlannedApp[] = [
	{ worker: 'al-ummah-now-media', maxInstances: 3746, vcpu: 4 },
	{ worker: 'al-ummah-now-media-stage', maxInstances: 2, vcpu: 4 },
	{ worker: 'al-ummah-now-media-qa', maxInstances: 2, vcpu: 4 },
];
// As Cloudflare reported the account on 2026-11-16 (production still at 4)
const account: AccountApp[] = [
	{ name: 'al-ummah-now-media-stage-transcoder-stage', maxInstances: 2, vcpu: 4 },
	{ name: 'al-ummah-now-media-transcoder', maxInstances: 4, vcpu: 4 },
	{ name: 'al-ummah-now-media-qa-transcoder', maxInstances: 2, vcpu: 4 },
];

test('the applications map to their Worker (production is a prefix of stage and QA)', () => {
	assert.equal(appOf(account[0]!, planned)?.worker, 'al-ummah-now-media-stage');
	assert.equal(appOf(account[1]!, planned)?.worker, 'al-ummah-now-media');
	assert.equal(appOf(account[2]!, planned)?.worker, 'al-ummah-now-media-qa');
	assert.equal(appOf({ name: 'someone-else', maxInstances: 1, vcpu: 1 }, planned), undefined);
});

test('3,746 standard-4 in production fits the 15,000 vCPU quota exactly with stage and QA at 2', () => {
	const v = checkQuota(15000, account, planned);
	assert.equal(v.ok, true);
	assert.equal(v.needed, 15000);
	assert.equal(v.productionMax, 3746);
});

test('v2026.11.15.3: 3,750 does not fit (15,016 needed)', () => {
	const v = checkQuota(15000, account, [{ ...planned[0]!, maxInstances: 3750 }, ...planned.slice(1)]);
	assert.equal(v.ok, false);
	assert.equal(v.needed, 15016);
	assert.equal(v.productionMax, 3746);
});

test('other applications on the account count as they are reserved now', () => {
	const v = checkQuota(15000, [...account, { name: 'another-project', maxInstances: 10, vcpu: 1 }], planned);
	assert.equal(v.ok, false);
	assert.equal(v.productionMax, 3743);
});

test('this checkout plans production, stage and QA from the media wrangler configs, and they fit the quota', () => {
	const p = plannedMediaApps();
	assert.deepEqual(p.map((x) => x.worker), ['al-ummah-now-media', 'al-ummah-now-media-stage', 'al-ummah-now-media-qa']);
	assert.equal(p[0]!.vcpu, INSTANCE_VCPU['standard-4']);
	assert.equal(checkQuota(15000, account, p).ok, true);
});
