/**
 * A profile's email is the signed-in account's (lib/account-email.ts): whatever
 * `email` a client sends is ignored, on create, on a create over an existing
 * profile and on update.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ProfileCreate } from '../src/endpoints/profile/profileCreate';
import { ProfileUpdate } from '../src/endpoints/profile/profileUpdate';
import { tokenEmail, withAccountEmail } from '../src/lib/account-email';
import { MemoryBucket, MemoryQueue, buildApp } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

const ME = 'usr_me';
const OTHER = 'someone-else@example.com';

const stored = (overrides: Record<string, unknown> = {}) => ({
	id: ME, displayName: 'Me', channels: ['ch1'], dateCreated: '2026-01-01T00:00:00.000Z', dateModified: '2026-01-01T00:00:00.000Z', ...overrides,
});

function setup(opts: { email?: string; profile?: Record<string, unknown> } = {}) {
	const profiles = new MemoryBucket(opts.profile ? { [ME]: opts.profile } : {});
	const env = { SEARCH_DB: new SqliteD1() as unknown as D1Database, profiles, queue: new MemoryQueue() };
	const app = buildApp((r: any) => {
		r.post('/api/profiles', ProfileCreate);
		r.put('/api/profile', ProfileUpdate);
	}, { userId: ME, email: opts.email ?? 'me@example.com' });
	const send = (method: string, path: string, body: unknown) =>
		app.request(path, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }, env);
	const read = async () => (await (await profiles.get(ME))!.json()) as Record<string, unknown>;
	return { send, read, profiles };
}

describe("a profile's email is the signed-in account's", () => {
	it('create ignores a different submitted email', async () => {
		const { send, read } = setup();
		const res = await send('POST', '/api/profiles', { email: OTHER, displayName: 'Me' });
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as any).result.profile.email, 'me@example.com');
		assert.equal((await read()).email, 'me@example.com');
	});

	it('create over an existing profile ignores it too, and keeps the rest of the profile', async () => {
		const { send, read } = setup({ profile: stored({ email: 'me@example.com' }) });
		assert.equal((await send('POST', '/api/profiles', { email: OTHER, displayName: 'Renamed' })).status, 200);
		const profile = await read();
		assert.equal(profile.email, 'me@example.com');
		assert.equal(profile.displayName, 'Renamed');
		assert.deepEqual(profile.channels, ['ch1']);
	});

	it('update ignores it', async () => {
		const { send, read } = setup({ profile: stored({ email: 'me@example.com' }) });
		const res = await send('PUT', '/api/profile', { email: OTHER, bio: 'Bio' });
		assert.equal(res.status, 200);
		assert.equal(((await res.json()) as any).result.profile.email, 'me@example.com');
		const profile = await read();
		assert.equal(profile.email, 'me@example.com');
		assert.equal(profile.bio, 'Bio');
	});

	it('email is optional, and is stored trimmed and in lower case', async () => {
		const { send, read } = setup({ email: ' Me@Example.COM ' });
		assert.equal((await send('POST', '/api/profiles', { displayName: 'Me' })).status, 200);
		assert.equal((await read()).email, 'me@example.com');
	});

	it('a create or update brings a stored email that differs back to the account\'s', async () => {
		for (const [method, path] of [['POST', '/api/profiles'], ['PUT', '/api/profile']]) {
			const { send, read } = setup({ profile: stored({ email: OTHER }) });
			assert.equal((await send(method, path, { email: OTHER })).status, 200);
			assert.equal((await read()).email, 'me@example.com', method);
		}
	});

	it('a token without an email stores none and leaves a stored one as it is', async () => {
		const fresh = setup({ email: '' });
		assert.equal((await fresh.send('POST', '/api/profiles', { email: OTHER })).status, 200);
		assert.equal('email' in (await fresh.read()), false);

		for (const [method, path] of [['POST', '/api/profiles'], ['PUT', '/api/profile']]) {
			const existing = setup({ email: '', profile: stored({ email: 'me@example.com' }) });
			assert.equal((await existing.send(method, path, { email: OTHER })).status, 200);
			assert.equal((await existing.read()).email, 'me@example.com', method);
		}
	});
});

describe('account email helpers', () => {
	it('reads the token email, or null', () => {
		assert.equal(tokenEmail({ email: ' A@B.co ' }), 'a@b.co');
		for (const auth of [null, undefined, {}, { email: '' }, { email: '  ' }]) assert.equal(tokenEmail(auth), null);
	});

	it('drops the submitted email from the fields', () => {
		assert.deepEqual(withAccountEmail({ email: OTHER, bio: 'x' }, { email: 'a@b.co' }), { email: 'a@b.co', bio: 'x' });
		assert.deepEqual(withAccountEmail({ email: OTHER, bio: 'x' }, {}), { bio: 'x' });
	});
});
