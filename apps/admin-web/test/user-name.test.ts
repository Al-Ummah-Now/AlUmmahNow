/**
 * adminUserName: admin pages call a user by the API's resolved display name
 * (display name, else first + last), then the email, never the id ("Unknown user" when nothing is known).
 * No @handle: handles belong to channels.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adminUserName } from '../src/lib/user-name';
import { userName } from '../src/components/content/transfer-model';

describe('adminUserName', () => {
	it('shows the resolved name the API sends (first + last for a profile without a display name)', () => {
		assert.equal(adminUserName({ id: 'u1', displayName: 'Mahmoud Darwish', email: 'a@b.c' }), 'Mahmoud Darwish');
	});

	it('treats empty and whitespace names as missing', () => {
		assert.equal(adminUserName({ id: 'u1', displayName: '  ', email: 'a@b.c' }), 'a@b.c');
		assert.equal(adminUserName({ id: 'u1', displayName: '', userName: 'legacy', email: 'a@b.c' } as never), 'a@b.c');
		// Never the raw id: the caller's "Unknown user" (empty by default)
		assert.equal(adminUserName({ id: 'usr_1', displayName: '', email: ' ' }), '');
		assert.equal(adminUserName({ userId: 'usr_2', displayName: '' }, 'Unknown user'), 'Unknown user');
		assert.equal(adminUserName(null, 'Unknown user'), 'Unknown user');
	});

	it('the user picker uses the same rule', () => {
		assert.equal(userName({ id: 'u1', displayName: '', userName: 'h', email: 'a@b.c' } as never), 'a@b.c');
	});
});
