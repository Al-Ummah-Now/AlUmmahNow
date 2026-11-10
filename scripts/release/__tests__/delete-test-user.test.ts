import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { assertTestAddress, deleteStatements, kvPrefixes, profileObjectPath } from '../delete-test-user.ts';

describe('assertTestAddress', () => {
	it('accepts only release test addresses', () => {
		assert.doesNotThrow(() => assertTestAddress('test-release-1762600000000-a1b2c3@delivered.resend.dev'));
		for (const email of [
			'someone@gmail.com',
			'test-release-1762600000000-a1b2c3@delivered.resend.dev.evil.com',
			'test-release-1762600000000-a1b2c3@resend.dev',
			'test-release-1762600000000-A1B2C3@delivered.resend.dev',
			'test-release-176260000000-a1b2c3@delivered.resend.dev',
			'x-test-release-1762600000000-a1b2c3@delivered.resend.dev',
			'test-release-1762600000000-a1b2c3@delivered.resend.dev\nadmin@alummahnow.net',
			'',
		]) {
			assert.throws(() => assertTestAddress(email), /not a release test account/, JSON.stringify(email));
		}
	});
});

describe('kvPrefixes', () => {
	const e = 'test-release-1762600000000-a1b2c3@delivered.resend.dev';
	it('covers the password identity and the email index; the user record only with an id', () => {
		assert.deepEqual(kvPrefixes(e), [`email\x1f${e}\x1f`, `user\x1femail\x1fdefault\x1f${e}`]);
		assert.deepEqual(kvPrefixes(e, 'u1').at(-1), 'user\x1fdefault\x1fu1');
	});
	it('ends the email prefix with the separator so a longer address never matches', () => {
		assert.ok(kvPrefixes(e)[0].endsWith('\x1f'));
	});
});

describe('deleteStatements', () => {
	it('deletes rows without an FK first, then the user, all parameterised', () => {
		const s = deleteStatements("u1'; DROP TABLE users; --");
		assert.deepEqual(s.map((x) => x.sql.split(' ')[2]), ['rbac_user_roles', 'account_sessions', 'users']);
		for (const x of s) {
			assert.ok(!x.sql.includes('u1'));
			assert.deepEqual(x.params, ["u1'; DROP TABLE users; --"]);
		}
	});
});

describe('profileObjectPath', () => {
	it('addresses the user\'s object in the production profiles bucket', () => {
		assert.equal(profileObjectPath('usr_0123456789abcdef0123456789abcdef'), '/r2/buckets/profiles/objects/usr_0123456789abcdef0123456789abcdef');
	});
	it('refuses anything that is not an auth user id (no other object can be targeted)', () => {
		for (const bad of ['', 'usr_', '../videos/x', 'usr_0123456789abcdef0123456789abcdef/../x', 'channel_1']) {
			assert.throws(() => profileObjectPath(bad), /refusing/);
		}
	});
});
