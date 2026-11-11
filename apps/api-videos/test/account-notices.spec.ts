/**
 * Account notices for admin-api (warn-user): the in-app notice payload sent to
 * the notification pipeline, and the contact an account email needs.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { MessageType } from '@al-ummah/shared-types';
import adminRouter from '../src/routers/admin.router';
import { accountNoticePayload } from '../src/lib/notifications';
import { MemoryBucket, MemoryQueue } from './helpers';
import { createSqliteD1 } from './sqlite-d1';

function setup() {
	const env = {
		profiles: new MemoryBucket({ usr_1: { id: 'usr_1', displayName: 'Amina', email: 'amina@example.com' }, usr_noemail: { id: 'usr_noemail', displayName: 'No mail' } }),
		queue: new MemoryQueue(),
		NOTIFICATIONS_DB: createSqliteD1(),
	} as any;
	const app = new Hono();
	app.route('/internal/admin', adminRouter);
	const call = async (method: string, path: string, json?: unknown) => {
		const res = await app.request(`/internal/admin${path}`, {
			method,
			headers: { 'Content-Type': 'application/json', 'X-Admin-Actor': 'usr_mod' },
			body: json === undefined ? undefined : JSON.stringify(json),
		}, env);
		return { status: res.status, body: (await res.json()) as any };
	};
	return { env, call };
}

describe('account notices (warn-user)', () => {
	it('builds the accountWarning notice: reason code and count as params, guidelines link, one per warning', () => {
		const payload = accountNoticePayload('usr_1', { kind: 'warning', noticeId: 'wrn_1', reasonCode: 'harassment', count: 3 }, 1000);
		assert.equal(payload.notificationKey, 'accountWarning');
		assert.equal(payload.recipientUserId, 'usr_1');
		assert.deepEqual(payload.params, { reason: 'harassment', count: 3 });
		assert.equal(payload.actionUrl, '/community-guidelines');
		assert.equal(payload.dedupeKey, 'warning:wrn_1');
		assert.equal(payload.entityId, 'wrn_1');
		assert.equal(payload.createdAt, 1000);
	});

	it('queues the notice on the notification pipeline', async () => {
		const { env, call } = setup();
		const res = await call('POST', '/users/usr_1/account-notices', { kind: 'warning', noticeId: 'wrn_1', reasonCode: 'spam', count: 1 });
		assert.equal(res.status, 200);
		assert.deepEqual(res.body.result, { queued: true });
		assert.equal(env.queue.messages.length, 1);
		const [message] = env.queue.messages;
		assert.equal(message.type, MessageType.NotificationCreate);
		assert.equal(message.payload.notificationKey, 'accountWarning');
		assert.deepEqual(message.payload.params, { reason: 'spam', count: 1 });
	});

	it('refuses an unknown user and a malformed notice', async () => {
		const { env, call } = setup();
		assert.equal((await call('POST', '/users/usr_gone/account-notices', { kind: 'warning', noticeId: 'w', reasonCode: 'spam', count: 1 })).status, 404);
		assert.equal((await call('POST', '/users/usr_1/account-notices', { kind: 'warning', noticeId: 'w', reasonCode: 'rude', count: 1 })).status, 400);
		assert.equal(env.queue.messages.length, 0);
	});

	it('gives the account email contact with the user preferences (defaults: on, English)', async () => {
		const { env, call } = setup();
		assert.deepEqual((await call('GET', '/users/usr_1/account-email')).body.result, {
			userId: 'usr_1',
			email: 'amina@example.com',
			displayName: 'Amina',
			accountEmail: true,
			locale: 'en',
		});
		env.NOTIFICATIONS_DB.raw.prepare("INSERT INTO notification_email_prefs VALUES ('usr_1', 0, 'ar', 0)").run();
		const changed = (await call('GET', '/users/usr_1/account-email')).body.result;
		assert.equal(changed.accountEmail, false);
		assert.equal(changed.locale, 'ar');
		assert.equal((await call('GET', '/users/usr_noemail/account-email')).body.result.email, null);
		assert.equal((await call('GET', '/users/usr_gone/account-email')).status, 404);
	});
});
