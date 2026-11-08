/**
 * Epic 27 enforcement. Grandfathering is the core rule: a limit only blocks NEW
 * actions, and nothing that already exists is deleted, hidden or refused.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { exceedsDurationLimit, linksAllowed, releaseReservation, releaseVideoStorage, reserveUpload } from '../src/lib/upload-quota';
import { ChannelCreate } from '../src/endpoints/channel/channelCreate';
import { ChannelUpdate } from '../src/endpoints/channel/channelUpdate';
import { buildApp, MemoryBucket } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

const MIGRATIONS = join(__dirname, '..', '..', 'admin-api', 'migrations');
const GB = 1_000_000_000;
const NOW = new Date('2026-11-08T00:00:00Z');

function env(extra: Record<string, unknown> = {}) {
	return { REPORTS_DB: createSqliteD1(MIGRATIONS), ...extra } as any;
}
const grant = (e: any, type: string, id: string, key: string, value: unknown) =>
	e.REPORTS_DB.raw.prepare("INSERT INTO entitlement_overrides (id, subject_type, subject_id, key, value_json, reason, created_by) VALUES (?, ?, ?, ?, ?, 'affected user', 'admin')").run(`${id}${key}`, type, id, key, JSON.stringify(value));
const counter = (e: any, key: string, period: string) =>
	Number(e.REPORTS_DB.raw.prepare("SELECT value FROM usage_counters WHERE subject_id = 'u' AND key = ? AND period = ?").get(key, period)?.value ?? 0);
const reserve = (e: any, count: number, bytes: number, declaredSeconds?: number) => reserveUpload(e, { userId: 'u', count, bytes, declaredSeconds }, NOW);

describe('upload quotas', () => {
	it('allows 10 uploads a month and refuses the 11th', async () => {
		const e = env();
		for (let i = 0; i < 10; i++) assert.equal((await reserve(e, 1, 1)).ok, true);
		const refused: any = await reserve(e, 1, 1);
		assert.equal(refused.ok, false);
		assert.equal(refused.key, 'upload.monthlyUploads');
		assert.equal(refused.limit, 10);
		assert.equal(refused.current, 10);
	});

	it('starts a fresh count each month', async () => {
		const e = env();
		for (let i = 0; i < 10; i++) await reserve(e, 1, 1);
		assert.equal((await reserveUpload(e, { userId: 'u', count: 1, bytes: 1 }, new Date('2026-12-01T00:00:00Z'))).ok, true);
	});

	it('cannot overshoot with parallel uploads', async () => {
		const e = env();
		const results = await Promise.all(Array.from({ length: 15 }, () => reserve(e, 1, 1)));
		assert.equal(results.filter((r) => r.ok).length, 10);
		assert.equal(counter(e, 'upload.monthlyUploads', '2026-11'), 10);
	});

	it('refuses a batch that would pass the limit, as a whole', async () => {
		const e = env();
		assert.equal((await reserve(e, 11, 11)).ok, false);
		assert.equal(counter(e, 'upload.monthlyUploads', '2026-11'), 0);
	});

	it('refuses past 5 GB and leaves the monthly count unchanged', async () => {
		const e = env();
		assert.equal((await reserve(e, 1, 5 * GB)).ok, true);
		const refused: any = await reserve(e, 1, 1);
		assert.equal(refused.key, 'storage.gb');
		assert.equal(counter(e, 'upload.monthlyUploads', '2026-11'), 1);
	});

	it('refuses a declared duration over 30 minutes before reserving anything', async () => {
		const e = env();
		const refused: any = await reserve(e, 1, 1, 1801);
		assert.equal(refused.key, 'upload.maxDurationMinutes');
		assert.equal(counter(e, 'upload.monthlyUploads', '2026-11'), 0);
		assert.equal((await reserve(e, 1, 1, 1800)).ok, true);
	});

	it('gives quota back when an upload cannot start', async () => {
		const e = env();
		const r: any = await reserve(e, 1, GB);
		await releaseReservation(e, r.reservation);
		assert.equal(counter(e, 'upload.monthlyUploads', '2026-11'), 0);
		assert.equal(counter(e, 'storage.gb', 'all'), 0);
	});

	it('frees storage on delete but keeps the monthly count', async () => {
		const e = env();
		await reserve(e, 1, GB);
		await releaseVideoStorage(e, { userId: 'u', usageBytes: GB });
		assert.equal(counter(e, 'storage.gb', 'all'), 0);
		assert.equal(counter(e, 'upload.monthlyUploads', '2026-11'), 1);
	});

	it('an admin override raises a limit for an affected user', async () => {
		const e = env();
		grant(e, 'user', 'u', 'upload.monthlyUploads', 12);
		for (let i = 0; i < 12; i++) assert.equal((await reserve(e, 1, 1)).ok, true);
		assert.equal((await reserve(e, 1, 1)).ok, false);
	});

	it('allows the upload when D1 is down or a write fails', async () => {
		assert.equal((await reserveUpload({}, { userId: 'u', count: 99, bytes: 99 * GB }, NOW)).ok, true);
		const e = env();
		const realPrepare = e.REPORTS_DB.prepare;
		e.REPORTS_DB.prepare = (sql: string) => {
			if (sql.startsWith('INSERT INTO usage_counters')) throw new Error('write failed');
			return realPrepare(sql);
		};
		assert.equal((await reserve(e, 1, 1)).ok, true);
	});
});

describe('grandfathering: existing videos', () => {
	it('never fails the duration check for a video without the enforcement marker', async () => {
		assert.equal(await exceedsDurationLimit(env(), { userId: 'u' }, 7200, NOW), false);
	});
	it('fails a new upload that encoded longer than the limit', async () => {
		assert.equal(await exceedsDurationLimit(env(), { userId: 'u', entitlementChecked: true }, 1801, NOW), true);
		assert.equal(await exceedsDurationLimit(env(), { userId: 'u', entitlementChecked: true }, 1800, NOW), false);
	});
	it('respects an override on the length limit', async () => {
		const e = env();
		grant(e, 'user', 'u', 'upload.maxDurationMinutes', 'unlimited');
		assert.equal(await exceedsDurationLimit(e, { userId: 'u', entitlementChecked: true }, 7200, NOW), false);
	});
});

describe('grandfathering: links', () => {
	it('keeps a channel above the limit, allows reductions, refuses only growth', () => {
		assert.equal(linksAllowed(5, 8, 8), true);
		assert.equal(linksAllowed(5, 8, 6), true);
		assert.equal(linksAllowed(5, 8, 0), true);
		assert.equal(linksAllowed(5, 8, 9), false);
	});
	it('applies the limit to channels under it', () => {
		assert.equal(linksAllowed(5, 3, 5), true);
		assert.equal(linksAllowed(5, 3, 6), false);
	});
});

const noopQueue = { send: async () => undefined };
const link = (i: number) => ({ title: `t${i}`, url: `https://example.org/${i}` });
const links = (n: number) => Array.from({ length: n }, (_, i) => link(i));

function channelEnv(channels: Record<string, unknown>) {
	return env({ channels: new MemoryBucket(channels), profiles: new MemoryBucket({ u: { email: 'u@test.local' } }), channel_tabs: new MemoryBucket(), queue: noopQueue });
}
const json = (body: unknown, method = 'POST') => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

describe('channel endpoints', () => {
	const create = (e: any, lang?: string) =>
		buildApp((r) => r.post('/channels', ChannelCreate), { userId: 'u' }).request('/channels', { ...json({ name: 'Second' }), headers: { 'content-type': 'application/json', ...(lang ? { 'accept-language': lang } : {}) } }, e);
	const update = (e: any, n: number) =>
		buildApp((r) => r.put('/channels/:id', ChannelUpdate), { userId: 'u' }).request('/channels/c1', json({ links: links(n) }, 'PUT'), e);

	it('refuses a second channel with 402 upgrade_required, in Arabic when asked', async () => {
		const e = channelEnv({ c1: { id: 'c1', userId: 'u', name: 'First' } });
		const res = await create(e, 'ar');
		assert.equal(res.status, 402);
		const body: any = await res.json();
		assert.equal(body.error, 'upgrade_required');
		assert.equal(body.entitlement, 'channel.max');
		assert.match(body.message, /[؀-ۿ]/);
	});

	it('lets a user make their first channel', async () => {
		assert.equal((await create(channelEnv({}))).status, 200);
	});

	it('a user above the limit keeps every channel and can still update them', async () => {
		const e = channelEnv({ c1: { id: 'c1', userId: 'u', name: 'A', links: [] }, c2: { id: 'c2', userId: 'u', name: 'B' } });
		assert.equal((await create(e)).status, 402);
		assert.ok(await e.channels.get('c1'));
		assert.ok(await e.channels.get('c2'));
		assert.equal((await update(e, 2)).status, 200);
	});

	it('an override allows a further channel', async () => {
		const e = channelEnv({ c1: { id: 'c1', userId: 'u', name: 'First' } });
		grant(e, 'user', 'u', 'channel.max', 2);
		assert.equal((await create(e)).status, 200);
	});

	it('a channel with 8 links can re-save or reduce them, not add', async () => {
		const seed = () => channelEnv({ c1: { id: 'c1', userId: 'u', name: 'A', links: links(8) } });
		assert.equal((await update(seed(), 8)).status, 200);
		assert.equal((await update(seed(), 6)).status, 200);
		assert.equal((await update(seed(), 9)).status, 402);
	});

	it('a new channel is held to 5 links', async () => {
		const seed = () => channelEnv({ c1: { id: 'c1', userId: 'u', name: 'A', links: [] } });
		assert.equal((await update(seed(), 5)).status, 200);
		assert.equal((await update(seed(), 6)).status, 402);
	});

	it('an override on the owner raises the link limit', async () => {
		const e = channelEnv({ c1: { id: 'c1', userId: 'u', name: 'A', links: [] } });
		grant(e, 'user', 'u', 'channel.about.links.max', 20);
		assert.equal((await update(e, 20)).status, 200);
	});

	it('does not check links when the update does not touch them', async () => {
		const e = channelEnv({ c1: { id: 'c1', userId: 'u', name: 'A', links: links(8) } });
		const res = await buildApp((r) => r.put('/channels/:id', ChannelUpdate), { userId: 'u' }).request('/channels/c1', json({ description: 'new' }, 'PUT'), e);
		assert.equal(res.status, 200);
	});
});
