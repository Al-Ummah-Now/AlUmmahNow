/**
 * adminUserName: admin pages call a user by the API's resolved display name
 * (display name, else first + last), then the email, then the id. No @handle: handles belong to channels.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { adminUserName } from '../src/lib/user-name';
import { userName } from '../src/components/content/userPickerModel';

describe('adminUserName', () => {
	it('shows the resolved name the API sends (first + last for a profile without a display name)', () => {
		assert.equal(adminUserName({ id: 'u1', displayName: 'Mahmoud Darwish', email: 'a@b.c' }), 'Mahmoud Darwish');
	});

	it('treats empty and whitespace names as missing', () => {
		assert.equal(adminUserName({ id: 'u1', displayName: '  ', email: 'a@b.c' }), 'a@b.c');
		assert.equal(adminUserName({ id: 'u1', displayName: '', userName: 'legacy', email: 'a@b.c' } as never), 'a@b.c');
		assert.equal(adminUserName({ id: 'u1', displayName: '', email: ' ' }), 'u1');
		assert.equal(adminUserName({ userId: 'u2', displayName: '' }), 'u2');
	});

	it('the user picker uses the same rule', () => {
		assert.equal(userName({ id: 'u1', displayName: '', userName: 'h', email: 'a@b.c' } as never), 'a@b.c');
	});
});
