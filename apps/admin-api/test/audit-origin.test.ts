import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { runWithErrorTrail } from '@al-ummah/shared-types/error-trail';
import { audit } from '../src/lib/authModeration';
import { adminRequestOrigin, auditOriginJson } from '../src/lib/request-origin';
import { sqliteD1 } from './d1-sqlite';

describe('audit rows record where the admin acted from', () => {
  it("admin-web's forwarded browser hints win over its own server request; native apps name themselves", () => {
    const viaWeb = new Request('https://admin.api.alummahnow.net/api/videos/v1', {
      headers: { 'X-Client-User-Agent': 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) Safari/604.1', 'X-Client-Country': 'SA', 'user-agent': 'undici' },
    });
    assert.deepEqual(adminRequestOrigin(viaWeb, {}), { surface: 'admin', source: 'direct', country: 'SA', device: 'tablet' });
    const native = new Request('https://admin.api.alummahnow.net/api/review/queue', { headers: { 'x-aun-client': 'aun-admin/1.2.0 (iOS 18.1)' } });
    assert.equal(adminRequestOrigin(native, {})?.surface, 'ios');
  });

  it('an audit row written during a request stores its origin; outside a request, null', async () => {
    const db = sqliteD1();
    const origin = { surface: 'android' as const, app: 'aun-admin', appVersion: '1.2.0', source: 'direct', device: 'phone' as const, country: 'EG', referrerHost: 'x.example', entry: '/api/x' };
    await runWithErrorTrail({ origin }, () => audit(db as never, { actorId: 'usr_admin1', action: 'test_action', targetType: 'user', targetId: 'usr_2' }));
    await audit(db as never, { actorId: 'usr_admin1', action: 'cron_action', targetType: 'user', targetId: 'usr_3' });
    const rows = (await db.prepare('SELECT action, origin FROM admin_audit_log ORDER BY action').all<{ action: string; origin: string | null }>()).results;
    assert.equal(rows.find((r) => r.action === 'cron_action')!.origin, null);
    // Surface, app, version, device and country only (no referrer or page)
    assert.deepEqual(JSON.parse(rows.find((r) => r.action === 'test_action')!.origin!), { surface: 'android', app: 'aun-admin', appVersion: '1.2.0', device: 'phone', country: 'EG' });
    assert.equal(auditOriginJson(), null);
  });
});
