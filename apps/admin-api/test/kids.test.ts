/**
 * Admin Ummah Kids API tests (wiki E20 §5.2, §6, §9; story E20-2):
 * - staff setup routes stay reachable while ummahKids is OFF so moderators and
 *   super admins can curate catalog & record decisions (B1 fix)
 * - catalog CRUD, channel refusal, staff-playlist enforcement, soft-delete (revoked
 *   restore + 30-day purge cleanup)
 * - atomic review-requests queue approve/decline & topic preservation
 * - policy readiness & precondition unblocking via real PUT /api/features/ummahKids
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Hono } from 'hono';
import { KIDS_DECISION_IDS, forgetFeatureSwitches } from '@al-ummah/shared-types';
import kidsRouter, { purgeExpiredKidsCatalogItems } from '../src/routers/kids.router';
import featuresRouter from '../src/routers/features.router';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { applyFeatureGates } from '../src/middleware/require-feature';
import { checkCanTurnOn } from '../src/lib/feature-preconditions';
import { sqliteD1 } from './d1-sqlite';

function searchD1() {
  const raw = new DatabaseSync(':memory:');
  const dir = join(process.cwd(), '..', 'api-videos', 'migrations', 'search');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    raw.exec(readFileSync(join(dir, f), 'utf8'));
  }
  const exec = (sql: string, args: unknown[]) => {
    const stmt = raw.prepare(sql);
    const params = args.map((a) => (a === undefined ? null : typeof a === 'boolean' ? (a ? 1 : 0) : a)) as never[];
    if (/^\s*(SELECT|WITH|EXPLAIN)/i.test(sql) || /\bRETURNING\b/i.test(sql)) {
      return { results: stmt.all(...params).map((r) => ({ ...r })), success: true };
    }
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
  return {
    raw,
    prepare: (sql: string) => statement(sql),
    batch: async (list: any[]) => {
      raw.exec('BEGIN');
      try {
        const res = list.map((s) => s._exec());
        raw.exec('COMMIT');
        return res;
      } catch (err) {
        raw.exec('ROLLBACK');
        throw err;
      }
    },
  };
}

function seedTargets(raw: DatabaseSync) {
  raw
    .prepare(
      `INSERT INTO search_videos (id, channel_id, visible, payload) VALUES
       ('vid_1', 'ch_staff', 1, '{"id":"vid_1","title":"Dua Video"}'),
       ('vid_99', 'ch_creator', 1, '{"id":"vid_99","title":"Creator Video"}'),
       ('vid_ready', 'ch_staff', 1, '{"id":"vid_ready","title":"Ready Video"}'),
       ('vid_hidden', 'ch_staff', 0, '{"id":"vid_hidden","title":"Hidden Video"}')`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO search_playlists (id, channel_id, visible, created_at, payload) VALUES
       ('pl_staff', 'ch_staff', 1, '2026-11-23T00:00:00Z', '{"id":"pl_staff","title":"Editorial Gems","channelId":"ch_staff","channelName":"Staff Channel"}'),
       ('pl_creator', 'ch_creator', 1, '2026-11-23T00:00:00Z', '{"id":"pl_creator","title":"Creator Playlist","channelId":"ch_creator","channelName":"Creator Channel"}')`,
    )
    .run();
  raw
    .prepare(
      `INSERT INTO kids_policy_settings (key, decisions_json, staff_channel_ids_json, legal_approved, updated_at)
       VALUES ('default', '{}', '["ch_staff"]', 0, '2026-11-23T00:00:00Z')`,
    )
    .run();
}

function setup(roles: string[]) {
  forgetFeatureSwitches();
  const search = searchD1();
  seedTargets(search.raw);
  const reports = sqliteD1();
  const env = { SEARCH_DB: search, REPORTS_DB: reports };
  const app = new Hono();
  app.use('*', errorEnvelope);
  applyFeatureGates(app, 'admin-api');
  app.use('*', async (c, next) => {
    c.set('auth' as never, { userId: 'usr_staff1', roles } as never);
    await next();
  });
  app.route('/api/kids', kidsRouter as never);
  app.route('/api/features', featuresRouter as never);
  const req = (path: string, init?: RequestInit) => app.request(path, init, env as never);
  const json = (method: string, path: string, body?: unknown) =>
    req(path, {
      method,
      ...(body !== undefined ? { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } } : {}),
    });
  return { search, reports, env, req, json };
}

beforeEach(() => forgetFeatureSwitches());

describe('admin /api/kids', () => {
  it('stays reachable while ummahKids switch is OFF and uses indexed admin query plans', async () => {
    const t = setup(['moderator']);
    const res = await t.req('/api/kids/catalog');
    assert.equal(res.status, 200);
    assert.deepEqual(((await res.json()) as any).result.items, []);

    const planIn = t.search.raw
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM kids_catalog_items WHERE status IN ('approved', 'revoked') ORDER BY position ASC, updated_at DESC, id ASC LIMIT 31 OFFSET 0")
      .all()
      .map((r: any) => String(r.detail))
      .join(' | ');
    assert.ok(planIn.includes('USING INDEX'), planIn);
    assert.ok(!planIn.includes('SCAN kids_catalog_items'), planIn);

    const planEq = t.search.raw
      .prepare("EXPLAIN QUERY PLAN SELECT * FROM kids_catalog_items WHERE status = 'approved' ORDER BY position ASC, updated_at DESC, id ASC LIMIT 31 OFFSET 0")
      .all()
      .map((r: any) => String(r.detail))
      .join(' | ');
    assert.ok(planEq.includes('USING INDEX idx_kids_catalog_admin'), planEq);
    assert.ok(!planEq.includes('USE TEMP B-TREE'), planEq);
  });

  it('refuses channels, nonexistent targets, and creator playlists; enforces staff-owned playlists', async () => {
    const t = setup(['moderator']);
    assert.equal((await t.json('POST', '/api/kids/catalog', { targetType: 'channel', targetId: 'ch_staff', ageBand: 'all' })).status, 400);
    assert.equal((await t.json('POST', '/api/kids/catalog', { targetType: 'video', targetId: 'vid_missing', ageBand: 'all' })).status, 404);
    assert.equal((await t.json('POST', '/api/kids/catalog', { targetType: 'video', targetId: 'vid_hidden', ageBand: 'all' })).status, 400);

    const creatorPl = await t.json('POST', '/api/kids/catalog', { targetType: 'playlist', targetId: 'pl_creator', ageBand: '3-6' });
    assert.equal(creatorPl.status, 403);
    assert.equal(((await creatorPl.json()) as any).code, 'kids_staff_playlist_required');

    const staffPick = await t.req('/api/kids/staff-playlists?q=Editorial');
    assert.equal(staffPick.status, 200);
    const pickItems = ((await staffPick.json()) as any).result.items;
    assert.deepEqual(pickItems.map((i: any) => i.id), ['pl_staff']);

    const staffPl = await t.json('POST', '/api/kids/catalog', { targetType: 'playlist', targetId: 'pl_staff', ageBand: '3-6', topics: ['dua'] });
    assert.equal(staffPl.status, 201);
  });

  it('preserves revoked status across delete/restore, blocks moderator undelete, and purges expired trash', async () => {
    const t = setup(['moderator']);
    const createRes = await t.json('POST', '/api/kids/catalog', {
      targetType: 'video',
      targetId: 'vid_1',
      ageBand: '3-6',
      topics: ['dua', 'arabic_letters'],
    });
    assert.equal(createRes.status, 201);
    const created = ((await createRes.json()) as any).result.item;

    // Revoke, then soft-delete and restore as admin -> status must stay 'revoked' (not re-approved!)
    const patchRes = await t.json('PATCH', `/api/kids/catalog/${created.id}`, { status: 'revoked', ageBand: 'all' });
    assert.equal(patchRes.status, 200);
    assert.equal(((await patchRes.json()) as any).result.item.status, 'revoked');

    assert.equal((await t.json('DELETE', `/api/kids/catalog/${created.id}`, { reason: 'cleanup' })).status, 403);

    // Share same DB via admin request
    t.search.raw
      .prepare("UPDATE kids_catalog_items SET pre_delete_status = status, status = 'deleted', deleted_at = '2026-10-01T00:00:00.000Z', purge_after = '2026-10-31T00:00:00.000Z' WHERE id = ?")
      .run(created.id);

    // Moderator POST /catalog cannot undelete trashed item
    const modReapprove = await t.json('POST', '/api/kids/catalog', { targetType: 'video', targetId: 'vid_1', ageBand: '3-6' });
    assert.equal(modReapprove.status, 409);

    const adminApp = new Hono();
    adminApp.use('*', errorEnvelope);
    adminApp.use('*', async (c, next) => {
      c.set('auth' as never, { userId: 'usr_admin', roles: ['admin'] } as never);
      await next();
    });
    adminApp.route('/api/kids', kidsRouter as never);
    const restoreRes = await adminApp.request(`/api/kids/catalog/${created.id}/restore`, { method: 'POST' }, t.env as never);
    assert.equal(restoreRes.status, 200);
    assert.equal(((await restoreRes.json()) as any).result.item.status, 'revoked');

    // Delete again with past purge_after -> hourly purge deletes permanently + audits, and no-op purge writes zero audit rows (Nit)
    const delAdminRes = await adminApp.request(
      `/api/kids/catalog/${created.id}`,
      { method: 'DELETE', body: JSON.stringify({ reason: 'duplicate' }), headers: { 'Content-Type': 'application/json' } },
      t.env as never,
    );
    assert.equal(delAdminRes.status, 200);
    t.search.raw
      .prepare("UPDATE kids_catalog_items SET purge_after = '2026-11-01T00:00:00.000Z' WHERE id = ?")
      .run(created.id);
    const purgeOut = await purgeExpiredKidsCatalogItems(t.search as never, new Date('2026-11-23T00:00:00.000Z'));
    assert.equal(purgeOut.purged, 1);
    assert.equal(t.search.raw.prepare('SELECT * FROM kids_catalog_items WHERE id = ?').get(created.id), undefined);
    const purgeAudit = t.search.raw.prepare("SELECT action FROM kids_catalog_audit WHERE entity_id = ? AND action = 'purge'").all(created.id) as any[];
    assert.equal(purgeAudit.length, 1);

    // Concurrent restore before DELETE runs: mocked prepare returns 0 rows on DELETE -> zero purge count & zero extra audit
    const restoreNoop = await purgeExpiredKidsCatalogItems(
      {
        prepare: (sql: string) => ({
          bind: (..._args: unknown[]) => ({
            all: async () => ({
              results: sql.includes('SELECT id, target_type') ? [{ id: 'kc_noop', target_type: 'video', target_id: 'vid_noop' }] : [],
            }),
            first: async () => null,
            run: async () => ({ results: [] }),
          }),
        }),
        batch: async () => [{ results: [] }, { results: [] }],
      } as never,
      new Date('2026-11-23T00:00:00.000Z'),
    );
    assert.equal(restoreNoop.purged, 0);

    // Removing a playlist's channel from staff_channel_ids_json restores soft-deleted playlist as 'revoked' (S-J)
    const plCreate = await t.json('POST', '/api/kids/catalog', { targetType: 'playlist', targetId: 'pl_staff', ageBand: 'all' });
    assert.equal(plCreate.status, 201);
    const plItem = ((await plCreate.json()) as any).result.item;
    await adminApp.request(`/api/kids/catalog/${plItem.id}`, { method: 'DELETE', body: JSON.stringify({}), headers: { 'Content-Type': 'application/json' } }, t.env as never);
    t.search.raw.prepare("UPDATE kids_policy_settings SET staff_channel_ids_json = '[]' WHERE key = 'default'").run();
    const plRestore = await adminApp.request(`/api/kids/catalog/${plItem.id}/restore`, { method: 'POST' }, t.env as never);
    assert.equal(plRestore.status, 200);
    assert.equal(((await plRestore.json()) as any).result.item.status, 'revoked');
  });

  it('decides review requests atomically, rolls back failed catalog writes, and rejects non-video approvals', async () => {
    const t = setup(['moderator']);
    t.search.raw
      .prepare(
        `INSERT INTO kids_catalog_items (id, target_type, target_id, age_band, status, topics_json, position, approved_by, approved_at, updated_at)
         VALUES ('kc_exist', 'video', 'vid_99', '7-12', 'revoked', '["quran"]', 0, 'usr_prev', '2026-11-20T00:00:00Z', '2026-11-20T00:00:00Z')`,
      )
      .run();
    t.search.raw
      .prepare(
        `INSERT INTO kids_review_requests (id, target_type, target_id, channel_id, requested_by, suggested_age_band, notes, status, created_at) VALUES
         ('rev_1', 'video', 'vid_99', 'ch_creator', 'usr_c1', '3-6', 'For toddlers', 'pending', '2026-11-23T00:00:00Z'),
         ('rev_2', 'video', 'vid_ready', 'ch_staff', 'usr_c1', '7-12', 'Second page check', 'pending', '2026-11-23T00:00:30Z'),
         ('rev_3', 'video', 'vid_1', 'ch_staff', 'usr_c1', 'all', 'Page two item', 'pending', '2026-11-23T00:00:45Z'),
         ('rev_ch', 'channel', 'ch_creator', 'ch_creator', 'usr_c1', 'all', 'Channel', 'pending', '2026-11-23T00:01:00Z')`,
      )
      .run();

    // Channel approval from review queue is refused, while decline succeeds
    assert.equal((await t.json('POST', '/api/kids/review-requests/rev_ch/decide', { decision: 'approved' })).status, 400);
    assert.equal((await t.json('POST', '/api/kids/review-requests/rev_ch/decide', { decision: 'declined', reason: 'Videos only' })).status, 200);

    // Simulated batch failure leaves request 'pending', writes zero catalog approval, and writes zero audit rows (SF-6)
    const origBatch = t.search.batch;
    t.search.batch = async () => {
      throw new Error('D1 audit write failed mid-batch');
    };
    const failRes = await t.json('POST', '/api/kids/review-requests/rev_2/decide', { decision: 'approved', ageBand: '7-12' });
    assert.equal(failRes.status, 500);
    assert.equal((t.search.raw.prepare("SELECT status FROM kids_review_requests WHERE id = 'rev_2'").get() as any).status, 'pending');
    assert.equal(t.search.raw.prepare("SELECT * FROM kids_catalog_items WHERE target_id = 'vid_ready'").get(), undefined);
    assert.equal(t.search.raw.prepare("SELECT * FROM kids_catalog_audit WHERE entity_id = 'rev_2'").get(), undefined);
    t.search.batch = origBatch;

    // Approving without topics preserves ['quran'] from existing catalog item
    const decideRes = await t.json('POST', '/api/kids/review-requests/rev_1/decide', {
      decision: 'approved',
      ageBand: '3-6',
    });
    assert.equal(decideRes.status, 200);
    assert.equal(((await decideRes.json()) as any).result.request.status, 'approved');

    const catRow = t.search.raw.prepare("SELECT status, age_band, topics_json FROM kids_catalog_items WHERE target_type = 'video' AND target_id = 'vid_99'").get() as any;
    assert.deepEqual({ ...catRow }, { status: 'approved', age_band: '3-6', topics_json: '["quran"]' });

    // Second concurrent decision on rev_1 fails with 409 and cannot flip approved state
    assert.equal((await t.json('POST', '/api/kids/review-requests/rev_1/decide', { decision: 'declined' })).status, 409);

    // Keyset cursor pagination traverses all pending reviews cleanly with zero duplicates
    const p1 = await t.req('/api/kids/review-requests?status=pending&limit=1');
    assert.equal(p1.status, 200);
    const b1 = ((await p1.json()) as any).result;
    assert.equal(b1.items.length, 1);
    assert.ok(b1.nextCursor);
    const p2 = await t.req(`/api/kids/review-requests?status=pending&limit=2&cursor=${encodeURIComponent(b1.nextCursor)}`);
    assert.equal(p2.status, 200);
    const b2 = ((await p2.json()) as any).result;
    assert.equal(b2.items.length, 1);
    assert.equal(b2.nextCursor, null);
    assert.notEqual(b2.items[0].id, b1.items[0].id);
  });

  it('unlocks PUT /api/features/ummahKids through staff catalog + policy routes (visible video only)', async () => {
    const sa = setup(['super_admin']);
    const blocked = await sa.json('PUT', '/api/features/ummahKids', { enabled: true, expectedVersion: 0 });
    assert.equal(blocked.status, 409);

    const decisions = Object.fromEntries(KIDS_DECISION_IDS.map((id) => [id, 'Option A']));
    // Approving a staff playlist alone must NOT satisfy the precondition without an approved visible video
    await sa.json('POST', '/api/kids/catalog', { targetType: 'playlist', targetId: 'pl_staff', ageBand: 'all' });
    sa.search.raw
      .prepare("INSERT OR IGNORE INTO content_ownership (kind, id, admin_title) VALUES ('channel', 'ch_staff', 'Al Noor Kids Studio')")
      .run();
    sa.search.raw
      .prepare("INSERT OR IGNORE INTO content_ownership (kind, id, admin_title) VALUES ('profile', 'usr_staff1', 'Super Admin')")
      .run();
    const putRes1 = await sa.json('PUT', '/api/kids/policy', { decisions, legalApproved: true, staffChannelIds: ['ch_staff'] });
    assert.equal(putRes1.status, 200);
    const putBody1 = ((await putRes1.json()) as any).result;
    assert.equal(putBody1.readiness.ready, false);
    assert.equal(putBody1.legalApprovedByName, 'Super Admin');
    assert.deepEqual(putBody1.staffChannels, [{ id: 'ch_staff', name: 'Al Noor Kids Studio' }]);

    await sa.json('POST', '/api/kids/catalog', { targetType: 'video', targetId: 'vid_ready', ageBand: 'all' });
    const check = await checkCanTurnOn(sa.env as never, 'ummahKids');
    assert.deepEqual(check, { ok: true });

    const enabled = await sa.json('PUT', '/api/features/ummahKids', { enabled: true, expectedVersion: 0 });
    assert.equal(enabled.status, 200);
    assert.equal(((await enabled.json()) as any).result.enabled, true);

    // PUT /policy enforces optimistic concurrency via expectedUpdatedAt (409 kids_policy_stale)
    const staleRes = await sa.json('PUT', '/api/kids/policy', {
      legalApproved: false,
      expectedUpdatedAt: '1999-01-01T00:00:00.000Z',
    });
    assert.equal(staleRes.status, 409);
    assert.equal(((await staleRes.json()) as any).code, 'kids_policy_stale');
  });

  it('preserves omitted topics/position on re-approve, updates PATCH partially, and pages staff-playlists across channels', async () => {
    const t = setup(['moderator']);
    const first = await t.json('POST', '/api/kids/catalog', {
      targetType: 'video',
      targetId: 'vid_1',
      ageBand: '3-6',
      topics: ['dua', 'quran'],
      position: 7,
    });
    assert.equal(first.status, 201);
    const item = ((await first.json()) as any).result.item;

    // PATCH with position only keeps ageBand and topics intact (Nit 2)
    const partial = await t.json('PATCH', `/api/kids/catalog/${item.id}`, { position: 9, status: 'revoked' });
    assert.equal(partial.status, 200);
    const patched = ((await partial.json()) as any).result.item;
    assert.equal(patched.ageBand, '3-6');
    assert.deepEqual(patched.topics, ['dua', 'quran']);
    assert.equal(patched.position, 9);

    // Re-approve omitting topics and position preserves existing values (Nit 3)
    const reapprove = await t.json('POST', '/api/kids/catalog', {
      targetType: 'video',
      targetId: 'vid_1',
      ageBand: 'all',
    });
    assert.equal(reapprove.status, 200);
    const reapproved = ((await reapprove.json()) as any).result.item;
    assert.equal(reapproved.ageBand, 'all');
    assert.deepEqual(reapproved.topics, ['dua', 'quran']);
    assert.equal(reapproved.position, 9);

    // Staff-playlists multi-page keyset cursor works within and across channels (Nit 1)
    t.search.raw
      .prepare("UPDATE kids_policy_settings SET staff_channel_ids_json = '[\"ch_staff\",\"ch_staff_2\"]' WHERE key = 'default'")
      .run();
    t.search.raw
      .prepare(
        `INSERT INTO search_playlists (id, channel_id, visible, created_at, payload) VALUES
         ('pl_staff_2', 'ch_staff', 1, '2026-11-22T00:00:00Z', '{"id":"pl_staff_2","title":"Second Editorial","channelId":"ch_staff","channelName":"Staff Channel"}'),
         ('pl_staff_ch2', 'ch_staff_2', 1, '2026-11-21T00:00:00Z', '{"id":"pl_staff_ch2","title":"Second Channel Playlist","channelId":"ch_staff_2","channelName":"Second Staff"}')`,
      )
      .run();
    const seenPl: string[] = [];
    let plCursor: string | null = null;
    for (let pageIdx = 0; pageIdx < 4; pageIdx++) {
      const url = plCursor ? `/api/kids/staff-playlists?limit=1&cursor=${encodeURIComponent(plCursor)}` : '/api/kids/staff-playlists?limit=1';
      const p = await t.req(url);
      assert.equal(p.status, 200);
      const b = ((await p.json()) as any).result;
      for (const item of b.items) seenPl.push(item.id);
      plCursor = b.nextCursor;
      if (!plCursor) break;
    }
    assert.deepEqual(seenPl, ['pl_staff', 'pl_staff_2', 'pl_staff_ch2']);

    // Typed search past 600 rows finds late playlist cleanly, and GET /catalog surfaces revocation reason
    for (let i = 0; i < 650; i++) {
      t.search.raw
        .prepare(
          `INSERT INTO search_playlists (id, channel_id, visible, created_at, payload) VALUES (?, 'ch_staff', 1, ?, ?)`,
        )
        .run(
          `pl_bulk_${String(i).padStart(4, '0')}`,
          `2025-01-01T00:${String(Math.floor(i / 60)).padStart(2, '0')}:${String(i % 60).padStart(2, '0')}Z`,
          JSON.stringify({ id: `pl_bulk_${i}`, title: i === 640 ? 'Hidden Treasure 640' : `Filler Playlist ${i}`, channelId: 'ch_staff' }),
        );
    }
    const deepSearch = await t.req('/api/kids/staff-playlists?q=Hidden%20Treasure%20640');
    assert.equal(deepSearch.status, 200);
    assert.deepEqual(((await deepSearch.json()) as any).result.items.map((x: any) => x.id), ['pl_bulk_0640']);

    await t.json('PATCH', `/api/kids/catalog/${reapproved.id}`, { status: 'revoked' });
    t.search.raw
      .prepare(
        `INSERT INTO kids_catalog_audit (id, entity_type, entity_id, action, actor_id, details_json, created_at)
         VALUES ('kaud_edit', 'catalog_item', ?, 'metadata_changed', 'usr_mod', '{"reason":"chapters_update"}', '2099-01-01T00:00:00Z')`,
      )
      .run(reapproved.id);
    const listRevoked = await t.req('/api/kids/catalog?status=revoked');
    const revItem = ((await listRevoked.json()) as any).result.items.find((x: any) => x.id === reapproved.id);
    assert.equal(revItem?.revokedByEdit, true);
    assert.equal(revItem?.revocationReason, 'chapters_update');
  });

  it('hydrates human titles and creator names for catalog and review rows when indexed', async () => {
    const t = setup(['moderator']);
    t.search.raw
      .prepare("INSERT INTO search_videos (id, payload) VALUES ('vid_named', ?)")
      .run(JSON.stringify({ title: 'Bedtime Duas for Little Hearts' }));
    t.search.raw
      .prepare("INSERT INTO content_ownership (kind, id, admin_title) VALUES ('channel', 'ch_named', 'Noor Kids Channel')")
      .run();
    t.search.raw
      .prepare("INSERT INTO content_ownership (kind, id, admin_title) VALUES ('profile', 'usr_named', 'Sister Amina')")
      .run();
    t.search.raw
      .prepare(
        `INSERT INTO kids_review_requests (id, target_type, target_id, channel_id, requested_by, suggested_age_band, status, created_at)
         VALUES ('krev_named', 'video', 'vid_named', 'ch_named', 'usr_named', '3-6', 'pending', '2026-11-23T00:00:00Z')`,
      )
      .run();
    await t.json('POST', '/api/kids/catalog', { targetType: 'video', targetId: 'vid_named', ageBand: '3-6' });

    const catRes = await t.req('/api/kids/catalog');
    assert.equal(catRes.status, 200);
    const catItem = ((await catRes.json()) as any).result.items[0];
    assert.equal(catItem.targetTitle, 'Bedtime Duas for Little Hearts');

    const revRes = await t.req('/api/kids/review-requests');
    assert.equal(revRes.status, 200);
    const revItem = ((await revRes.json()) as any).result.items[0];
    assert.equal(revItem.targetTitle, 'Bedtime Duas for Little Hearts');
    assert.equal(revItem.channelName, 'Noor Kids Channel');
    assert.equal(revItem.requestedByName, 'Sister Amina');
  });
});
