import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readAddresses } from '../delete-test-user.ts';
import {
	assertTestAddress,
	authDeleteStatements,
	channelKeys,
	isSettled,
	isTestAddress,
	kvKeys,
	KV_SEP,
	kvValueUserId,
	refreshPrefix,
	searchChannelDeleteStatements,
	searchProfileDeleteStatements,
} from '../prod-test-data.ts';

describe('assertTestAddress', () => {
	it('accepts the test inbox addresses every prod check and probe uses', () => {
		for (const email of [
			'test-release-1762600000000-a1b2c3@delivered.resend.dev',
			'test-history-1794138981441@delivered.resend.dev',
			'test-rev-a-1794174937@delivered.resend.dev',
			'test-cms-member-1794140593@delivered.resend.dev',
			'signup-1794174937-ab12cd@e2e.alummahnow.net',
		])
			assert.doesNotThrow(() => assertTestAddress(email), email);
	});
	it('refuses anything else, including look-alikes', () => {
		for (const email of [
			'someone@gmail.com',
			'meywd@msn.com',
			'test@mahmoudsdarwish.com',
			'delivered@resend.dev',
			'qa-admin@delivered.resend.dev',
			'test-release-1762600000000-a1b2c3@delivered.resend.dev.evil.com',
			'test-release-1762600000000-a1b2c3@resend.dev',
			'test-release-1762600000000-A1B2C3@delivered.resend.dev',
			'x-test-release-1762600000000-a1b2c3@delivered.resend.dev',
			'test-release-1762600000000-a1b2c3@delivered.resend.dev\nadmin@alummahnow.net',
			'a@e2e.alummahnow.net.evil.com',
			'',
		]) {
			assert.throws(() => assertTestAddress(email), /not a production test account/, JSON.stringify(email));
			assert.equal(isTestAddress(email), false);
		}
	});
	it('readAddresses dedupes and refuses the whole file on one bad line', () => {
		const e = 'test-release-1762600000000-a1b2c3@delivered.resend.dev';
		assert.deepEqual(readAddresses(`${e}\n\n${e}\n`), [e]);
		assert.throws(() => readAddresses(`${e}\nmeywd@msn.com\n`), /not a production test account/);
	});
});

describe('kvKeys', () => {
	const e = 'test-release-1762600000000-a1b2c3@delivered.resend.dev';
	it('uses openauth\'s "::" separator (the old \\x1f one matched nothing on production)', () => {
		assert.equal(KV_SEP, '::');
		assert.deepEqual(kvKeys(e), [`email::${e}::password`, `email::${e}::subject`, `user::email::default::${e}`]);
		assert.equal(kvKeys(e, 'usr_1').at(-1), 'user::default::usr_1');
		for (const k of kvKeys(e, 'usr_1')) assert.ok(!k.includes('\x1f'));
	});
	it('refresh tokens: only an openauth subject, prefix ends with the separator', () => {
		assert.equal(refreshPrefix('user:944e0ed07925c692'), 'oauth:refresh::user:944e0ed07925c692::');
		for (const bad of ['', 'user:', 'user:*', 'usr_0123', 'user:944e0ed07925c692::x']) assert.throws(() => refreshPrefix(bad), /refusing/);
	});
});

describe('kvValueUserId', () => {
	const id = 'usr_0123456789abcdef0123456789abcdef';
	it('reads the user id of sessions and refresh tokens', () => {
		assert.equal(kvValueUserId(JSON.stringify({ user: { id, email: 'x' }, tokens: {} })), id);
		assert.equal(kvValueUserId(JSON.stringify({ type: 'user', properties: { id }, subject: 'user:0123456789abcdef' })), id);
	});
	it('names no user for anything else', () => {
		for (const v of ['', 'not json', '"user:0123456789abcdef"', JSON.stringify({ user: { id: 'user_system' } }), JSON.stringify({ properties: {} })])
			assert.equal(kvValueUserId(v), undefined, v);
	});
});

describe('authDeleteStatements', () => {
	const id = 'usr_0123456789abcdef0123456789abcdef';
	it('roles, account sessions, browser sessions, then the user; all parameterised', () => {
		const s = authDeleteStatements(id);
		assert.deepEqual(
			s.map((x) => x.sql.split(' ').slice(0, 3).join(' ')),
			['DELETE FROM rbac_user_roles', 'DELETE FROM account_sessions', 'UPDATE browser_sessions SET', 'DELETE FROM users'],
		);
		for (const x of s) {
			assert.ok(!x.sql.includes(id));
			assert.deepEqual(x.params, [id]);
		}
	});
	it('refuses anything that is not an auth user id', () => {
		for (const bad of ['', 'usr_', "u1'; DROP TABLE users; --", 'user_system']) assert.throws(() => authDeleteStatements(bad), /refusing/);
	});
});

describe('channel cleanup', () => {
	const id = '0249a9b7-5b7b-4e33-a535-e303115e6fd1';
	it('deletes the record, tab config, its own sections and its handle', () => {
		assert.deepEqual(channelKeys({ id, handle: 'Probemw7s8qj8' }, [`${id}/s1`, 'other-channel/s2']), [
			{ bucket: 'channels', key: id },
			{ bucket: 'channel-tabs', key: `channel-tabs/${id}` },
			{ bucket: 'channel-sections', key: `${id}/s1` },
			{ bucket: 'channel-tabs', key: 'channel-handles/probemw7s8qj8' },
		]);
		assert.equal(channelKeys({ id }, []).length, 2);
	});
	it('search: tombstones first, then FTS, row and ownership, parameterised', () => {
		const s = searchChannelDeleteStatements(id, 5);
		assert.deepEqual(s.map((x) => x.params[0]), ['channel', 'own:channel', id, id, id]);
		assert.ok(s[2].sql.includes('search_channels_fts'));
		for (const x of s) assert.ok(!x.sql.includes(id));
		assert.throws(() => searchChannelDeleteStatements("x' OR 1=1 --", 1), /refusing/);
	});
});

describe('searchProfileDeleteStatements', () => {
	it("drops the user's admin-directory profile row and tombstones it, by bound parameter only", () => {
		const id = 'usr_0123456789abcdef0123456789abcdef';
		const s = searchProfileDeleteStatements(id, 7);
		assert.deepEqual(s.map((x) => x.params), [['own:profile', id, 7], [id]]);
		assert.ok(s[1].sql.includes("kind = 'profile'"));
		for (const x of s) assert.ok(!x.sql.includes(id));
		assert.throws(() => searchProfileDeleteStatements("x' OR 1=1 --", 1), /refusing/);
	});
});

describe('isSettled', () => {
	it('skips accounts a running prod check may still use; unknown age counts as a leftover', () => {
		const hour = 3_600_000;
		assert.equal(isSettled({ createdAt: 10 * hour }, 10.5 * hour, hour), false);
		assert.equal(isSettled({ createdAt: 10 * hour }, 11 * hour, hour), true);
		assert.equal(isSettled({}, 0, hour), true);
	});
});
