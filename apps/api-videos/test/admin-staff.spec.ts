/**
 * The admin staff lookup (contact inbox "Assign to"): every live account that
 * holds one of the asked admin roles, read-only from the auth tables.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { cleanStaffRoles, listStaff } from '../src/lib/admin/staff';

function authDb() {
	const db = new DatabaseSync(':memory:');
	db.exec(`CREATE TABLE users (id TEXT PRIMARY KEY, tenant_id TEXT NOT NULL, email TEXT NOT NULL, name TEXT, status TEXT NOT NULL DEFAULT 'active', deleted_at INTEGER);
		CREATE TABLE rbac_user_roles (user_id TEXT NOT NULL, role_id TEXT NOT NULL, tenant_id TEXT NOT NULL, expires_at INTEGER, PRIMARY KEY (user_id, role_id, tenant_id));
		CREATE INDEX idx_rbac_user_roles_role ON rbac_user_roles(role_id);`);
	const user = db.prepare("INSERT INTO users (id, tenant_id, email, name, status, deleted_at) VALUES (?, 'default', ?, ?, ?, ?)");
	user.run('u_amina', 'amina@alummahnow.net', 'Amina', 'active', null);
	user.run('u_bilal', 'bilal@alummahnow.net', null, 'active', null);
	user.run('u_omar', 'omar@alummahnow.net', 'Omar', 'active', null);
	user.run('u_gone', 'gone@alummahnow.net', 'Gone', 'active', 1);
	user.run('u_off', 'off@alummahnow.net', 'Suspended', 'suspended', null);
	user.run('u_mod', 'mod@alummahnow.net', 'Moderator', 'active', null);
	const role = db.prepare("INSERT INTO rbac_user_roles (user_id, role_id, tenant_id, expires_at) VALUES (?, ?, 'default', ?)");
	role.run('u_amina', 'role_admin', null);
	role.run('u_amina', 'role_super_admin', null);
	role.run('u_bilal', 'role_admin', null);
	role.run('u_omar', 'role_admin', 1000); // expired
	role.run('u_gone', 'role_admin', null);
	role.run('u_off', 'role_admin', null);
	role.run('u_mod', 'role_moderator', null);
	return {
		prepare: (sql: string) => ({
			bind: (...args: unknown[]) => ({ all: async <T>() => ({ results: db.prepare(sql).all(...(args as never[])) as T[] }) }),
		}),
		plan: (sql: string) => db.prepare(`EXPLAIN QUERY PLAN ${sql}`).all(),
	};
}

describe('admin staff lookup', () => {
	it('lists every live holder of the asked roles once, by name, without expired, deleted or suspended accounts', async () => {
		const staff = await listStaff(authDb(), ['role_super_admin', 'role_admin'], 5000);
		assert.deepEqual(
			staff.map((s) => [s.id, s.email, s.name, s.roles.sort()]),
			[
				['u_amina', 'amina@alummahnow.net', 'Amina', ['role_admin', 'role_super_admin']],
				['u_bilal', 'bilal@alummahnow.net', null, ['role_admin']],
			],
		);
	});

	it('answers only for the admin roles it knows', () => {
		assert.deepEqual(cleanStaffRoles('role_admin, role_viewer,role_super_admin'), ['role_super_admin', 'role_admin']);
		assert.deepEqual(cleanStaffRoles(undefined), []);
	});

	it('nothing asked, nothing read', async () => {
		assert.deepEqual(await listStaff(authDb(), []), []);
	});
});
