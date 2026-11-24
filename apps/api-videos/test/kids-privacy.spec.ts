/**
 * GDPR Art. 15/17 export & erasure coverage for Ummah Kids tables (wiki E20 §8; story E20-4).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { ownershipCompleteKey } from '@al-ummah/shared-types';
import { OperationBudget } from '../src/lib/privacy/scan';
import { DELETED_USER_ID, collectUserData, eraseUserData } from '../src/lib/privacy/user-data';
import { eraseRunUserData } from '../src/lib/privacy/run-user-erase';
import { setParentalPin, updateParentalControls } from '../src/lib/kids/parental-controls';
import { MemoryBucket } from './helpers';
import { SqliteD1 } from './search-sqlite-d1';

function makePrivacyEnv(db: SqliteD1, userId: string) {
  return {
    SEARCH_DB: db,
    profiles: new MemoryBucket({ [userId]: { id: userId, name: 'Parent' } }),
    channels: new MemoryBucket(),
    channel_sections: new MemoryBucket(),
    channel_tabs: new MemoryBucket(),
    videos: new MemoryBucket(),
    watch_history: new MemoryBucket(),
    community_posts: new MemoryBucket(),
    playlists: new MemoryBucket(),
    reports: new MemoryBucket(),
    'upload-defaults': new MemoryBucket(),
  };
}

describe('Ummah Kids GDPR export and erasure', () => {
  it('exports parentalControls metadata without PIN hashes and erases + tombstones rows on full erasure', async () => {
    const db = new SqliteD1();
    const userId = 'usr_parent_gdpr';
    await setParentalPin(db as never, userId, '5678');
    await updateParentalControls(db as never, userId, {
      activeAgeBand: '3-6',
      dailyLimitMinutes: 30,
      prayerPauseEnabled: true,
    });
    await db
      .prepare(
        `INSERT INTO kids_review_requests (id, target_type, target_id, channel_id, requested_by, suggested_age_band, notes, status, decided_by, created_at)
         VALUES ('krr_1', 'video', 'vid_1', 'ch_1', ?, '3-6', 'for kids', 'approved', ?, '2026-11-23T00:00:00Z')`,
      )
      .bind(userId, userId)
      .run();
    await db
      .prepare(
        `INSERT INTO kids_catalog_audit (id, entity_type, entity_id, action, actor_id, details_json, created_at)
         VALUES ('kca_1', 'catalog_item', 'kc_1', 'approve', ?, '{"reason":"reviewed"}', '2026-11-23T00:00:00Z')`,
      )
      .bind(userId)
      .run();

    const env = makePrivacyEnv(db, userId);
    const exported = await collectUserData(env as never, userId, new OperationBudget(500));
    assert.equal(exported.complete, true);
    assert.ok(exported.parentalControls);
    const pc = exported.parentalControls as Record<string, unknown>;
    assert.equal(pc.hasPin, true);
    assert.equal(pc.activeAgeBand, '3-6');
    assert.equal(pc.dailyLimitMinutes, 30);
    assert.equal('pinHash' in pc, false);
    assert.equal('pinSalt' in pc, false);
    assert.equal('pin_hash' in pc, false);
    assert.equal('pin_salt' in pc, false);

    const erased = await eraseUserData(env as never, userId, new OperationBudget(500));
    assert.equal(erased.complete, true);
    assert.equal(erased.deleted.parentalControls, 1);

    const pcRow = await db
      .prepare('SELECT COUNT(*) AS n FROM parental_controls WHERE user_id = ?')
      .bind(userId)
      .first<{ n: number }>();
    assert.equal(pcRow?.n ?? 0, 0);

    const reviewRow = await db
      .prepare("SELECT requested_by, decided_by FROM kids_review_requests WHERE id = 'krr_1'")
      .first<{ requested_by: string; decided_by: string }>();
    assert.equal(reviewRow?.requested_by, DELETED_USER_ID);
    assert.equal(reviewRow?.decided_by, DELETED_USER_ID);

    const auditRow = await db
      .prepare("SELECT actor_id FROM kids_catalog_audit WHERE id = 'kca_1'")
      .first<{ actor_id: string }>();
    assert.equal(auditRow?.actor_id, DELETED_USER_ID);
  });

  it('also erases and tombstones Kids tables on fast index-backed eraseRunUserData', async () => {
    const db = new SqliteD1();
    const userId = 'usr_parent_fast';
    await setParentalPin(db as never, userId, '9999');
    await db
      .prepare(
        `INSERT INTO kids_review_requests (id, target_type, target_id, channel_id, requested_by, suggested_age_band, status, created_at)
         VALUES ('krr_2', 'video', 'vid_2', 'ch_2', ?, 'all', 'pending', '2026-11-23T00:00:00Z')`,
      )
      .bind(userId)
      .run();
    await db
      .prepare("INSERT OR REPLACE INTO search_meta (key, value, updated_at) VALUES (?, '1', '2026-11-23T00:00:00Z'), (?, '1', '2026-11-23T00:00:00Z')")
      .bind(ownershipCompleteKey('channel'), ownershipCompleteKey('video'))
      .run();

    const env = makePrivacyEnv(db, userId);
    const result = await eraseRunUserData(env as never, userId, new OperationBudget(500));
    assert.equal(result.complete, true);

    const pcRow = await db
      .prepare('SELECT COUNT(*) AS n FROM parental_controls WHERE user_id = ?')
      .bind(userId)
      .first<{ n: number }>();
    assert.equal(pcRow?.n ?? 0, 0);

    const reviewRow = await db
      .prepare("SELECT requested_by FROM kids_review_requests WHERE id = 'krr_2'")
      .first<{ requested_by: string }>();
    assert.equal(reviewRow?.requested_by, DELETED_USER_ID);
  });
});
