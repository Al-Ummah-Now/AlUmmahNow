/**
 * The videos admin's own staff list (admin_staff, migration 0039): recorded
 * from each admin token's claims, throttled, inactivated when the role is
 * gone or the account is suspended/deleted, and the contact picker's source.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import { STAFF_THROTTLE_MS, deactivateStaff, getActiveStaff, listActiveStaff, recordStaffToken, resetStaffThrottle, staffRoleOf } from '../src/lib/admin-staff';
import { syncMirror } from '../src/lib/authModeration';
import { adminMiddleware } from '../src/middleware/auth';
import { sqliteD1 } from './d1-sqlite';

const t0 = new Date('2026-11-16T09:00:00Z');
const later = (ms: number) => new Date(t0.getTime() + ms);
const row = async (db: ReturnType<typeof sqliteD1>, id: string) =>
  db.prepare('SELECT user_id, role, name, email, active, inactive_reason, last_seen_at FROM admin_staff WHERE user_id = ?').bind(id).first<{ role: string; name: string | null; email: string | null; active: number; inactive_reason: string | null; last_seen_at: string }>();

describe('admin staff list', () => {
  beforeEach(() => resetStaffThrottle());

  it('takes the highest staff role from the token (display names or ids)', () => {
    assert.equal(staffRoleOf(['Super Admin', 'Moderator']), 'super_admin');
    assert.equal(staffRoleOf(['admin']), 'admin');
    assert.equal(staffRoleOf(['moderator']), 'moderator');
    assert.equal(staffRoleOf(['creator']), null);
    assert.equal(staffRoleOf(undefined), null);
  });

  it('records a staff token with its role, email and profile name (upsert)', async () => {
    const db = sqliteD1();
    const names: string[] = [];
    const lookup = async (id: string) => (names.push(id), 'Amina Yusuf');
    assert.equal(await recordStaffToken(db, { userId: 'u1', roles: ['Admin'], email: 'Amina@AlUmmahNow.net' }, t0, lookup), 'recorded');
    assert.deepEqual({ ...(await row(db, 'u1')) }, { user_id: 'u1', role: 'admin', name: 'Amina Yusuf', email: 'amina@alummahnow.net', active: 1, inactive_reason: null, last_seen_at: t0.toISOString() });
    assert.deepEqual(names, ['u1']);
  });

  it('writes at most once per user per throttle window, unless the role or email changes', async () => {
    const db = sqliteD1();
    let lookups = 0;
    const lookup = async () => (lookups++, null);
    await recordStaffToken(db, { userId: 'u1', roles: ['admin'], email: 'a@x.org' }, t0, lookup);
    assert.equal(await recordStaffToken(db, { userId: 'u1', roles: ['admin'], email: 'a@x.org' }, later(60_000), lookup), 'skipped', 'within the window: not even a statement');
    assert.equal(lookups, 1, 'no name lookup when nothing is written');
    // A new isolate (memory throttle empty) still leaves the row alone within the window: the upsert is conditional
    resetStaffThrottle();
    await recordStaffToken(db, { userId: 'u1', roles: ['admin'], email: 'a@x.org' }, later(120_000), lookup);
    assert.equal((await row(db, 'u1'))?.last_seen_at, t0.toISOString());
    // A role change is written at once
    await recordStaffToken(db, { userId: 'u1', roles: ['Super Admin'], email: 'a@x.org' }, later(180_000), lookup);
    assert.equal((await row(db, 'u1'))?.role, 'super_admin');
    // After the window, last seen moves on
    await recordStaffToken(db, { userId: 'u1', roles: ['Super Admin'], email: 'a@x.org' }, later(STAFF_THROTTLE_MS + 200_000), lookup);
    assert.equal((await row(db, 'u1'))?.last_seen_at, later(STAFF_THROTTLE_MS + 200_000).toISOString());
  });

  it('a later token without a staff role makes the row inactive; the role coming back makes it active again', async () => {
    const db = sqliteD1();
    await recordStaffToken(db, { userId: 'u1', roles: ['admin'], email: 'a@x.org' }, t0);
    assert.equal(await recordStaffToken(db, { userId: 'u1', roles: ['creator'], email: 'a@x.org' }, later(1000)), 'deactivated');
    assert.deepEqual([(await row(db, 'u1'))?.active, (await row(db, 'u1'))?.inactive_reason], [0, 'role_removed']);
    assert.deepEqual(await listActiveStaff(db, ['admin', 'super_admin']), []);
    await recordStaffToken(db, { userId: 'u1', roles: ['admin'], email: 'a@x.org' }, later(2000));
    assert.equal((await row(db, 'u1'))?.active, 1);
    // A token with no staff role and no row: nothing is created
    await recordStaffToken(db, { userId: 'u9', roles: [], email: 'x@x.org' }, t0);
    assert.equal(await row(db, 'u9'), null);
  });

  it('the picker source: active rows with the asked roles, matched by name or email, by name', async () => {
    const db = sqliteD1();
    await recordStaffToken(db, { userId: 'u_b', roles: ['admin'], email: 'bilal@alummahnow.net' }, t0, async () => 'Bilal');
    await recordStaffToken(db, { userId: 'u_a', roles: ['super_admin'], email: 'amina@alummahnow.net' }, t0, async () => 'Amina');
    await recordStaffToken(db, { userId: 'u_m', roles: ['moderator'], email: 'musa@alummahnow.net' }, t0, async () => 'Musa');
    await recordStaffToken(db, { userId: 'u_o', roles: ['admin'], email: 'omar@alummahnow.net' }, t0, async () => 'Omar');
    await deactivateStaff(db, 'u_o', 'suspended', t0);
    const contact = ['super_admin', 'admin'] as const;
    assert.deepEqual((await listActiveStaff(db, contact)).map((r) => r.user_id), ['u_a', 'u_b']);
    assert.deepEqual((await listActiveStaff(db, contact, 'BIL')).map((r) => r.user_id), ['u_b'], 'by name');
    assert.deepEqual((await listActiveStaff(db, contact, 'amina@')).map((r) => r.user_id), ['u_a'], 'by email');
    assert.equal((await getActiveStaff(db, 'u_m', contact)), null, 'a moderator has no contact access');
    assert.equal((await getActiveStaff(db, 'u_o', contact)), null, 'inactive');
    assert.equal((await getActiveStaff(db, 'u_a', contact))?.email, 'amina@alummahnow.net');
  });

  it('an Auth request that suspends or deletes a staff member, once actioned, makes the row inactive', async () => {
    const db = sqliteD1();
    await recordStaffToken(db, { userId: 'u_s', roles: ['admin'], email: 's@x.org' }, t0);
    const mirror = { id: 'r1', status: 'pending', decision_note: null, history: '[]', evidence: '[]', subject_user_id: 'u_s', action: 'suspend_account' } as never;
    await syncMirror(db, mirror, { status: 'approved', decision_note: null, history: [], evidence: [] } as never, t0.toISOString());
    assert.equal((await row(db, 'u_s'))?.active, 1, 'approved is not done yet');
    await syncMirror(db, { ...(mirror as object), status: 'approved' } as never, { status: 'actioned', decision_note: null, history: [], evidence: [] } as never, t0.toISOString());
    assert.deepEqual([(await row(db, 'u_s'))?.active, (await row(db, 'u_s'))?.inactive_reason], [0, 'suspended']);
  });

  it('the admin middleware records each staff token after the response', async () => {
    const db = sqliteD1();
    const pending: Promise<unknown>[] = [];
    const app = new Hono();
    app.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'u_mw', email: 'mw@alummahnow.net', roles: ['admin'] } as never);
      await next();
    });
    app.use('*', adminMiddleware);
    app.get('/api/x', (c) => c.json({ ok: true }));
    const res = await app.request('/api/x', {}, { REPORTS_DB: db }, { waitUntil: (p: Promise<unknown>) => pending.push(p), passThroughOnException: () => {}, props: {} } as never);
    assert.equal(res.status, 200);
    await Promise.all(pending);
    assert.equal((await row(db, 'u_mw'))?.role, 'admin');
  });
});
