/**
 * /api/video-categories: admins add, rename (en + ar), reorder, retire and
 * restore categories (videos:categories); moderators only read. Values never
 * change, every change is audited (dropped again when it fails), api-videos is
 * told to drop its cached list, and a rename queues the search relabel job.
 */
import { afterEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { MessageType, VIDEO_CATEGORIES, getActiveVideoCategories, resetVideoCategories, videoCategoryLabel } from '@al-ummah/shared-types';
import router from '../src/routers/videoCategories.router';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH)/i.test(sql)) return { results: stmt.all(...params).map((r) => ({ ...r })), success: true };
    stmt.run(...params);
    return { results: [], success: true };
  };
  const statement = (sql: string, args: unknown[] = []): any => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async () => (exec(sql, args).results[0] as unknown) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { raw, prepare: (sql: string) => statement(sql), batch: async (list: any[]) => list.map((s) => s._exec()) };
}

function setup(roles: string[], opts: { queueFails?: boolean } = {}) {
  const search = searchD1();
  const reports = sqliteD1();
  const messages: any[] = [];
  const invalidations: string[] = [];
  const env = {
    SEARCH_DB: search,
    REPORTS_DB: reports,
    INTERNAL_API_KEY: 'k',
    queue: { async send(m: unknown) { if (opts.queueFails) throw new Error('queue down'); messages.push(m); } },
    VIDEOS: { async fetch(input: string, init?: RequestInit) { invalidations.push(`${init?.method} ${new URL(input).pathname} ${new Headers(init?.headers).get('X-API-Key')}`); return new Response('{"success":true}'); } },
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'admin-1', roles } as never);
    await next();
  });
  app.route('/api/video-categories', router);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const send = (method: string, json?: unknown): RequestInit => ({ method, ...(json === undefined ? {} : { body: JSON.stringify(json), headers: { 'Content-Type': 'application/json' } }) });
  const audit = async () => ((await reports.prepare("SELECT key, old_value, new_value, actor_id FROM site_settings_log WHERE key LIKE 'content:category:%' ORDER BY created_at, rowid").all<any>()).results ?? []).map((r: any) => ({ key: r.key, old: r.old_value ? JSON.parse(r.old_value) : null, new: JSON.parse(r.new_value), actor: r.actor_id }));
  const list = async () => ((await (await req('/api/video-categories')).json()) as any).result;
  return { req, send, audit, list, search, messages, invalidations };
}

afterEach(() => resetVideoCategories());

describe('/api/video-categories', () => {
  it('lists the seeded categories in order with video counts; moderators read but change nothing', async () => {
    const { req, send, list, search, audit } = setup(['moderator']);
    search.raw.exec("INSERT INTO search_videos (id, category, payload) VALUES ('v1', 'fiqh', '{}'), ('v2', 'fiqh', '{}')");
    const result = await list();
    assert.equal(result.canManage, false);
    assert.deepEqual(result.categories.map((c: any) => c.value), VIDEO_CATEGORIES.map((c) => c.value));
    assert.equal(result.categories.find((c: any) => c.value === 'fiqh').videoCount, 2);
    assert.equal((await req('/api/video-categories', send('POST', { labelEn: 'X', labelAr: 'س' }))).status, 403);
    assert.equal((await req('/api/video-categories/fiqh', send('PATCH', { retired: true }))).status, 403);
    assert.equal((await req('/api/video-categories/order', send('PUT', { values: [] }))).status, 403);
    assert.deepEqual(await audit(), []);
  });

  it('an admin adds a category: slug from the English name, last in order, audited, live at once, api-videos told', async () => {
    const { req, send, list, audit, invalidations } = setup(['admin']);
    const res = await req('/api/video-categories', send('POST', { labelEn: '  Seerah for   kids ', labelAr: 'السيرة للأطفال', hint: 'stories of the Prophet for children' }));
    assert.equal(res.status, 201);
    const created = ((await res.json()) as any).result.category;
    assert.equal(created.value, 'seerah_for_kids');
    assert.equal(created.label.en, 'Seerah for kids');
    const categories = (await list()).categories;
    assert.equal(categories.at(-1).value, 'seerah_for_kids');
    assert.ok(getActiveVideoCategories().some((c) => c.value === 'seerah_for_kids'), 'this isolate reloaded');
    assert.deepEqual(invalidations, ['POST /internal/categories/invalidate k']);
    const [row] = await audit();
    assert.equal(row.key, 'content:category:seerah_for_kids');
    assert.equal(row.new.action, 'create');
    assert.equal(row.actor, 'admin-1');

    const dup = await req('/api/video-categories', send('POST', { value: 'fiqh', labelEn: 'Fiqh again', labelAr: 'فقه' }));
    assert.equal(dup.status, 409);
    const bad = await req('/api/video-categories', send('POST', { value: 'Bad Slug!', labelEn: '', labelAr: 'x'.repeat(61) }));
    assert.equal(bad.status, 400);
    assert.deepEqual(((await bad.json()) as any).fields, { value: 'invalid_slug', labelEn: 'required', labelAr: 'too_long' });
  });

  it('a rename changes both labels, keeps the value, queues the search relabel and is audited with the old labels', async () => {
    const { req, send, audit, messages } = setup(['super_admin']);
    const res = await req('/api/video-categories/fiqh', send('PATCH', { labelEn: 'Jurisprudence', labelAr: 'أحكام الفقه' }));
    assert.equal(res.status, 200);
    assert.equal(videoCategoryLabel('fiqh', 'ar'), 'أحكام الفقه');
    assert.equal(messages.length, 1);
    assert.equal(messages[0].type, MessageType.CategoryRelabel);
    assert.deepEqual(messages[0].payload, { category: 'fiqh', entity: 'video', from: { en: 'Fiqh', ar: 'الفقه' }, to: { en: 'Jurisprudence', ar: 'أحكام الفقه' } });
    const [row] = await audit();
    assert.deepEqual({ action: row.new.action, old: row.old }, { action: 'update', old: { labelEn: 'Fiqh', labelAr: 'الفقه' } });
    const immutable = await req('/api/video-categories/fiqh', send('PATCH', { value: 'jurisprudence' }));
    assert.equal(immutable.status, 400);
    assert.equal(((await immutable.json()) as any).code, 'immutable_value');
  });

  it('a rename whose relabel job cannot be queued is undone and its audit row dropped', async () => {
    const { req, send, list, audit } = setup(['admin'], { queueFails: true });
    const res = await req('/api/video-categories/fiqh', send('PATCH', { labelEn: 'Jurisprudence' }));
    assert.equal(res.status, 503);
    assert.equal((await list()).categories.find((c: any) => c.value === 'fiqh').label.en, 'Fiqh');
    assert.deepEqual(await audit(), []);
  });

  it('retire hides from the active list (label kept), restore brings it back; the last active one stays', async () => {
    const { req, send, list, audit } = setup(['admin']);
    assert.equal((await req('/api/video-categories/ramadan', send('PATCH', { retired: true }))).status, 200);
    assert.ok(!getActiveVideoCategories().some((c) => c.value === 'ramadan'));
    assert.equal(videoCategoryLabel('ramadan', 'en'), 'Ramadan');
    assert.equal((await list()).categories.find((c: any) => c.value === 'ramadan').retired, true);
    assert.equal((await req('/api/video-categories/ramadan', send('PATCH', { retired: false }))).status, 200);
    assert.ok(getActiveVideoCategories().some((c) => c.value === 'ramadan'));
    assert.deepEqual((await audit()).map((r) => r.new.action), ['retire', 'restore']);

    for (const c of VIDEO_CATEGORIES.slice(1)) await req(`/api/video-categories/${c.value}`, send('PATCH', { retired: true }));
    const last = await req(`/api/video-categories/${VIDEO_CATEGORIES[0]!.value}`, send('PATCH', { retired: true }));
    assert.equal(last.status, 400);
    assert.equal(((await last.json()) as any).code, 'last_active');
  });

  it('reorder takes every value once; history lists the changes newest first', async () => {
    const { req, send, list } = setup(['admin']);
    const values = VIDEO_CATEGORIES.map((c) => c.value).reverse();
    assert.equal((await req('/api/video-categories/order', send('PUT', { values: values.slice(1) }))).status, 400);
    assert.equal((await req('/api/video-categories/order', send('PUT', { values: [...values.slice(1), 'made_up'] }))).status, 400);
    assert.equal((await req('/api/video-categories/order', send('PUT', { values }))).status, 200);
    assert.deepEqual((await list()).categories.map((c: any) => c.value), values);
    assert.equal(getActiveVideoCategories()[0]!.value, values[0]);
    await req('/api/video-categories/khutbah', send('PATCH', { hint: 'Friday and Eid sermons' }));
    const history = ((await (await req('/api/video-categories/history')).json()) as any).result.entries;
    assert.deepEqual(history.map((e: any) => [e.value, e.change.action]), [['khutbah', 'update'], ['*order', 'reorder']]);
  });
});
