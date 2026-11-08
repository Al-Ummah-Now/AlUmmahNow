import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DeviceRegister, DevicesList, DeviceUnregister } from '../src/endpoints/devices/devices';
import { DeviceRegistrationSchema, MAX_DEVICES_PER_USER, deleteUserDevices, registerDevice } from '../src/lib/push-devices';
import { buildApp } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

/** Push device registration (Epic 9.4). */

const APNS = 'a'.repeat(64);
const APNS_2 = 'b'.repeat(64);
const FCM = 'fcm_' + 'x'.repeat(140) + ':APA91b';
const WNS = 'https://db5p.notify.windows.com/w/?token=AwYAAAB';
const SUB = {
	endpoint: 'https://fcm.googleapis.com/fcm/send/abc123',
	expirationTime: null,
	keys: { p256dh: 'B'.repeat(87), auth: 'A'.repeat(22) },
};

const routes = (r: any) => {
	r.get('/api/devices', DevicesList);
	r.put('/api/devices/:installId', DeviceRegister);
	r.delete('/api/devices/:installId', DeviceUnregister);
};

function harness() {
	const db = createSqliteD1();
	const as = (userId: string) => {
		const app = buildApp(routes, { userId });
		const env = { NOTIFICATIONS_DB: db } as any;
		return {
			put: (installId: string, body: unknown) =>
				app.request(`/api/devices/${installId}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, env),
			del: (installId: string) => app.request(`/api/devices/${installId}`, { method: 'DELETE' }, env),
			list: async () => ((await (await app.request('/api/devices', {}, env)).json()) as any).result.devices as any[],
		};
	};
	return { db, as };
}

describe('registration validation', () => {
	const ok = (body: unknown) => DeviceRegistrationSchema.safeParse(body).success;

	it('accepts each provider in its own format', () => {
		assert.ok(ok({ platform: 'ios', provider: 'apns', token: APNS }));
		assert.ok(ok({ platform: 'android', provider: 'fcm', token: FCM, locale: 'ar', appVersion: '1.2.0' }));
		assert.ok(ok({ platform: 'windows', provider: 'wns', token: WNS }));
		assert.ok(ok({ platform: 'web', provider: 'webpush', subscription: SUB, categories: ['live'] }));
	});

	it('rejects tokens in the wrong format, foreign WNS hosts and mismatched platforms', () => {
		assert.ok(!ok({ platform: 'ios', provider: 'apns', token: 'not-hex' }));
		assert.ok(!ok({ platform: 'windows', provider: 'wns', token: 'https://evil.example/notify.windows.com' }));
		assert.ok(!ok({ platform: 'windows', provider: 'wns', token: 'http://db5p.notify.windows.com/x' }));
		assert.ok(!ok({ platform: 'android', provider: 'apns', token: APNS }));
		assert.ok(!ok({ platform: 'web', provider: 'webpush', token: APNS }), 'webpush needs a subscription');
		assert.ok(!ok({ platform: 'ios', provider: 'apns', token: APNS, subscription: SUB }));
		assert.ok(!ok({ platform: 'ios', provider: 'apns', token: APNS, categories: ['spam'] }));
	});

	it('Web Push endpoints must be a real push service (the sender POSTs there: no SSRF)', () => {
		const web = (endpoint: string) => ok({ platform: 'web', provider: 'webpush', subscription: { ...SUB, endpoint } });
		for (const good of [
			'https://fcm.googleapis.com/fcm/send/x',
			'https://updates.push.services.mozilla.com/wpush/v2/x',
			'https://web.push.apple.com/QGx',
			'https://wns2-par02p.notify.windows.com/w/?token=x',
		]) assert.ok(web(good), good);
		for (const bad of [
			'https://169.254.169.254/latest/meta-data',
			'https://127.0.0.1/x',
			'https://internal.example.com/x',
			'https://fcm.googleapis.com.evil.example/x',
			'https://evilpush.apple.com/x',
			'https://fcm.googleapis.com:8443/x',
			'https://user:pw@fcm.googleapis.com/x',
			'https://fcm.googleapis.com./x',
			'http://fcm.googleapis.com/x',
		]) assert.ok(!web(bad), bad);
		assert.ok(!ok({ platform: 'windows', provider: 'wns', token: 'https://x.notify.windows.com:444/w' }));
	});
});

describe('PUT/GET/DELETE /api/devices', () => {
	it('registers, refreshes idempotently and lists without the raw token', async () => {
		const { as } = harness();
		const me = as('usr_me');
		const first = await me.put('install-0001', { platform: 'ios', provider: 'apns', token: APNS, locale: 'ar' });
		assert.equal(first.status, 200, await first.clone().text());
		assert.equal(((await first.json()) as any).result.created, true);

		const again = await me.put('install-0001', { platform: 'ios', provider: 'apns', token: APNS_2, locale: 'en', categories: ['live', 'live'] });
		assert.equal(((await again.json()) as any).result.created, false);

		const devices = await me.list();
		assert.equal(devices.length, 1);
		assert.deepEqual(
			{ locale: devices[0].locale, categories: devices[0].categories, tokenHint: devices[0].tokenHint },
			{ locale: 'en', categories: ['live'], tokenHint: '…bbbbbb' },
		);
		assert.ok(!JSON.stringify(devices).includes(APNS_2), 'token never returned');
	});

	it('stores the Web Push subscription and hints at its endpoint', async () => {
		const { as, db } = harness();
		await as('usr_me').put('browser-0001', { platform: 'web', provider: 'webpush', subscription: SUB });
		const [row] = db.rows('SELECT token FROM push_devices');
		assert.deepEqual(JSON.parse(row.token), { endpoint: SUB.endpoint, keys: SUB.keys });
		assert.equal((await as('usr_me').list())[0].tokenHint, '…abc123');
	});

	it('rejects bad install ids and bodies with 400', async () => {
		const me = harness().as('usr_me');
		assert.equal((await me.put('x', { platform: 'ios', provider: 'apns', token: APNS })).status, 400);
		assert.equal((await me.put('install-0001', { platform: 'ios', provider: 'apns', token: 'zz' })).status, 400);
	});

	it("can't take over another user's install without its token", async () => {
		const { as } = harness();
		await as('usr_victim').put('install-0001', { platform: 'ios', provider: 'apns', token: APNS });
		const hijack = await as('usr_attacker').put('install-0001', { platform: 'ios', provider: 'apns', token: APNS_2 });
		assert.equal(hijack.status, 409);
		assert.equal((await as('usr_victim').list()).length, 1);
		assert.equal((await as('usr_attacker').list()).length, 0);
	});

	it('the same device signing in as someone else (same token) moves to that account', async () => {
		const { as } = harness();
		await as('usr_a').put('install-0001', { platform: 'ios', provider: 'apns', token: APNS });
		assert.equal((await as('usr_b').put('install-0001', { platform: 'ios', provider: 'apns', token: APNS })).status, 200);
		assert.equal((await as('usr_a').list()).length, 0);
		assert.equal((await as('usr_b').list()).length, 1);
	});

	it('a reinstall (new install id, same token) replaces the old row', async () => {
		const { as } = harness();
		const me = as('usr_me');
		await me.put('install-old1', { platform: 'android', provider: 'fcm', token: FCM });
		await me.put('install-new1', { platform: 'android', provider: 'fcm', token: FCM });
		assert.deepEqual((await me.list()).map((d) => d.installId), ['install-new1']);
	});

	it('only the owner can unregister; unknown installs are 404', async () => {
		const { as } = harness();
		await as('usr_me').put('install-0001', { platform: 'ios', provider: 'apns', token: APNS });
		assert.equal((await as('usr_other').del('install-0001')).status, 404);
		assert.equal((await as('usr_me').del('install-0001')).status, 200);
		assert.equal((await as('usr_me').del('install-0001')).status, 404);
		assert.equal((await as('usr_me').list()).length, 0);
	});

	it('503 when the database is not bound', async () => {
		const res = await buildApp(routes, { userId: 'usr_me' }).request('/api/devices', {}, {} as any);
		assert.equal(res.status, 503);
	});
});

describe('device store', () => {
	it(`keeps at most ${MAX_DEVICES_PER_USER} devices per user, dropping the least recently updated`, async () => {
		const db = createSqliteD1() as any;
		for (let i = 0; i < MAX_DEVICES_PER_USER + 3; i++) {
			const token = i.toString(16).padStart(64, '0');
			assert.ok((await registerDevice(db, 'usr_me', `install-${String(i).padStart(4, '0')}`, { platform: 'ios', provider: 'apns', token }, 1000 + i)).ok);
		}
		const ids = db.rows('SELECT install_id FROM push_devices ORDER BY updated_at').map((r: any) => r.install_id);
		assert.equal(ids.length, MAX_DEVICES_PER_USER);
		assert.equal(ids[0], 'install-0003', 'the three oldest went');
	});

	it('deleteUserDevices removes only that user', async () => {
		const db = createSqliteD1() as any;
		await registerDevice(db, 'usr_a', 'install-a001', { platform: 'ios', provider: 'apns', token: APNS });
		await registerDevice(db, 'usr_b', 'install-b001', { platform: 'ios', provider: 'apns', token: APNS_2 });
		assert.equal(await deleteUserDevices(db, 'usr_a'), 1);
		assert.deepEqual(db.rows('SELECT user_id FROM push_devices').map((r: any) => r.user_id), ['usr_b']);
	});
});
