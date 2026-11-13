/**
 * /api/status/* (videos admin Status page, docs/status-page/README.md): admins only,
 * en + ar text required, incident and maintenance lifecycles, soft delete → restore →
 * purge, audit rows. STATUS_DB carries apps/status's migrations.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import statusRouter, { parseIncidentInput, uptimeShare } from '../src/routers/status.router';
import { hasPermission } from '../src/lib/roles';
import { sqliteD1 } from './d1-sqlite';

/** STATUS_DB with apps/status's migrations (tests run from apps/admin-api). */
function statusD1(): D1Database {
  const dir = join(process.cwd(), '..', 'status', 'migrations');
  const db = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) db.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = db.prepare(sql);
    const p = args.map((a) => (a === undefined ? null : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...p), success: true, meta: { changes: 0 } };
    const r = stmt.run(...p);
    return { results: [], success: true, meta: { changes: Number(r.changes) } };
  };
  const st = (sql: string, args: unknown[] = []) => ({
    bind: (...n: unknown[]) => st(sql, n),
    first: async <T>() => (exec(sql, args).results[0] as T) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { prepare: (sql: string) => st(sql), batch: async (list: { _exec(): unknown }[]) => list.map((s) => s._exec()) } as unknown as D1Database;
}

function setup(roles: string[], withDb = true) {
  const env = { STATUS_DB: withDb ? statusD1() : undefined, REPORTS_DB: sqliteD1() };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/status', statusRouter);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  return { req, env };
}
const send = (method: string, json: unknown): RequestInit => ({ method, body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } });
const incident = { kind: 'incident', titleEn: 'Slow playback', titleAr: 'تشغيل بطيء', impact: 'partial', components: ['playback'], bodyEn: 'Looking into it.', bodyAr: 'نتحقق من الأمر.' };

describe('status permissions', () => {
  it('status:manage is for admins and super admins, never moderators', () => {
    assert.equal(hasPermission(['Admin'], 'status:manage'), true);
    assert.equal(hasPermission(['Super Admin'], 'status:manage'), true);
    assert.equal(hasPermission(['Moderator'], 'status:manage'), false);
  });
  it('refuses moderators; 503 without STATUS_DB', async () => {
    const { req } = setup(['moderator']);
    assert.equal((await req('/api/status/overview')).status, 403);
    assert.equal((await req('/api/status/incidents', send('POST', incident))).status, 403);
    assert.equal((await setup(['Admin'], false).req('/api/status/overview')).status, 503);
  });
});

describe('parseIncidentInput', () => {
  const now = new Date('2026-11-13T12:00:00Z');
  it('needs both languages, known components and a valid status', () => {
    assert.match(String(parseIncidentInput({ ...incident, titleAr: '' }, now)), /Arabic titles/);
    assert.match(String(parseIncidentInput({ ...incident, bodyEn: ' ' }, now)), /messages/);
    assert.match(String(parseIncidentInput({ ...incident, components: ['nope'] }, now)), /components/);
    assert.match(String(parseIncidentInput({ ...incident, components: [] }, now)), /components/);
    assert.match(String(parseIncidentInput({ ...incident, status: 'scheduled' }, now)), /status must be/);
    assert.match(String(parseIncidentInput({ ...incident, impact: 'meh' }, now)), /impact/);
    assert.match(String(parseIncidentInput({ ...incident, titleEn: 'x'.repeat(141) }, now)), /140/);
  });
  it('defaults: incident starts now as investigating; maintenance needs a window', () => {
    const ok = parseIncidentInput({ ...incident, components: ['playback', 'playback'] }, now);
    assert.equal(typeof ok, 'object');
    assert.equal((ok as { status: string }).status, 'investigating');
    assert.equal((ok as { startsAt: string }).startsAt, now.toISOString());
    assert.deepEqual((ok as { components: string[] }).components, ['playback']);
    assert.match(String(parseIncidentInput({ ...incident, kind: 'maintenance', status: 'scheduled' }, now)), /end time/);
    const m = parseIncidentInput({ ...incident, kind: 'maintenance', startsAt: '2026-11-15T02:00:00Z', endsAt: '2026-11-15T03:00:00Z' }, now) as { status: string; impact: string };
    assert.equal(m.status, 'scheduled');
    assert.equal(m.impact, 'maintenance');
    assert.match(String(parseIncidentInput({ ...incident, kind: 'maintenance', startsAt: '2026-11-15T02:00:00Z', endsAt: '2026-11-15T01:00:00Z' }, now)), /after/);
  });
});

describe('incident lifecycle', () => {
  it('create → update → resolve, audited, listed on the overview', async () => {
    const { req, env } = setup(['Admin']);
    const created = await req('/api/status/incidents', send('POST', incident));
    assert.equal(created.status, 201);
    const { result: inc } = (await created.json()) as { result: { id: string; status: string; updates: unknown[] } };
    assert.equal(inc.status, 'investigating');
    assert.equal(inc.updates.length, 1);

    const up = await req(`/api/status/incidents/${inc.id}/updates`, send('POST', { status: 'identified', bodyEn: 'A CDN region.', bodyAr: 'منطقة شبكة.', impact: 'major' }));
    assert.equal(up.status, 201);
    assert.equal(((await up.json()) as { result: { impact: string } }).result.impact, 'major');

    assert.equal((await req(`/api/status/incidents/${inc.id}/updates`, send('POST', { status: 'completed', bodyEn: 'x', bodyAr: 'س' }))).status, 400);

    let o = ((await (await req('/api/status/overview')).json()) as { result: { open: { id: string }[]; recent: unknown[] } }).result;
    assert.deepEqual(o.open.map((i) => i.id), [inc.id]);

    const res = await req(`/api/status/incidents/${inc.id}/updates`, send('POST', { status: 'resolved', bodyEn: 'Fixed.', bodyAr: 'تم الإصلاح.' }));
    const resolved = ((await res.json()) as { result: { resolvedAt: string | null; updates: { status: string }[] } }).result;
    assert.ok(resolved.resolvedAt);
    assert.deepEqual(resolved.updates.map((u) => u.status), ['resolved', 'identified', 'investigating']);
    o = ((await (await req('/api/status/overview')).json()) as { result: { open: { id: string }[]; recent: unknown[] } }).result;
    assert.equal(o.open.length, 0);
    assert.equal(o.recent.length, 1);

    const audits = (await env.REPORTS_DB.prepare("SELECT action FROM admin_audit_log WHERE target_type = 'status_incident' ORDER BY created_at").all<{ action: string }>()).results;
    assert.deepEqual(audits.map((a) => a.action), ['status.incident.create', 'status.incident.update', 'status.incident.update']);
  });

  it('edits titles and components', async () => {
    const { req } = setup(['Super Admin']);
    const { result: inc } = (await (await req('/api/status/incidents', send('POST', incident))).json()) as { result: { id: string } };
    const r = await req(`/api/status/incidents/${inc.id}`, send('PATCH', { titleEn: 'Playback errors', components: ['playback', 'api'] }));
    const body = ((await r.json()) as { result: { titleEn: string; titleAr: string; components: string[] } }).result;
    assert.equal(body.titleEn, 'Playback errors');
    assert.equal(body.titleAr, 'تشغيل بطيء');
    assert.deepEqual(body.components, ['playback', 'api']);
    assert.equal((await req(`/api/status/incidents/${inc.id}`, send('PATCH', { components: ['x'] }))).status, 400);
  });

  it('delete is soft: restore works, purge only after delete', async () => {
    const { req, env } = setup(['Admin']);
    const { result: inc } = (await (await req('/api/status/incidents', send('POST', incident))).json()) as { result: { id: string } };
    assert.equal((await req(`/api/status/incidents/${inc.id}/purge`, { method: 'POST' })).status, 404, 'purge needs a delete first');
    const del = (await (await req(`/api/status/incidents/${inc.id}`, { method: 'DELETE' })).json()) as { result: { deletedAt: string; purgeAfter: string } };
    assert.ok(del.result.deletedAt);
    assert.ok(del.result.purgeAfter > del.result.deletedAt);
    let o = ((await (await req('/api/status/overview')).json()) as { result: { open: unknown[]; deleted: { id: string }[] } }).result;
    assert.equal(o.open.length, 0);
    assert.deepEqual(o.deleted.map((i) => i.id), [inc.id]);
    assert.equal((await req(`/api/status/incidents/${inc.id}/restore`, { method: 'POST' })).status, 200);
    o = ((await (await req('/api/status/overview')).json()) as { result: { open: unknown[]; deleted: { id: string }[] } }).result;
    assert.equal(o.open.length, 1);
    await req(`/api/status/incidents/${inc.id}`, { method: 'DELETE' });
    assert.equal((await req(`/api/status/incidents/${inc.id}/purge`, { method: 'POST' })).status, 200);
    assert.equal(await env.STATUS_DB!.prepare('SELECT id FROM incidents WHERE id = ?').bind(inc.id).first(), null);
    assert.equal((await env.STATUS_DB!.prepare('SELECT COUNT(*) AS n FROM incident_updates').first<{ n: number }>())!.n, 0);
  });
});

describe('status overview: the full internal view', () => {
  it('returns every component, public and internal, with 90-day uptime', async () => {
    const { req, env } = setup(['Admin']);
    const day = new Date().toISOString().slice(0, 10);
    await env.STATUS_DB!.prepare("INSERT INTO component_state VALUES ('cms', 'major', 'major', 2, ?, ?, 120, 'CMS deep health: HTTP 500', 1)").bind(day, day).run();
    await env.STATUS_DB!.prepare("INSERT INTO daily (component, day, operational, partial, major) VALUES ('cms', ?, 90, 10, 0)").bind(day).run();
    const o = ((await (await req('/api/status/overview')).json()) as { result: { checks: { component: string; detail: string }[]; uptime90: Record<string, number> } }).result;
    assert.deepEqual(o.checks.map((c) => c.component), ['cms']);
    assert.equal(o.checks[0].detail, 'CMS deep health: HTTP 500');
    assert.equal(o.uptime90.cms, 0.97);
  });
  it('uptime: major down, partial 30%, rounds down, null without runs', () => {
    assert.equal(uptimeShare({ operational: 9, degraded: 0, partial: 0, major: 1 }), 0.9);
    assert.equal(uptimeShare({ operational: 99999, degraded: 0, partial: 0, major: 1 }), 0.9999);
    assert.equal(uptimeShare({ operational: 0, degraded: 0, partial: 0, major: 0 }), null);
  });
});
