/**
 * admin-api writes to shared R2 documents never undo, or get undone by, a
 * concurrent writer (SCALABILITY-AUDIT AA-1, AA-2, AA-3, AA-5), and the
 * section index rebuild reads a bounded amount (AA-4).
 *
 * The R2 fake honours onlyIf.etagMatches and yields with random latency on
 * every call, so writers interleave the way they do across isolates. The
 * "other writers" (owner edits, new comments) use the same conditional write,
 * as api-videos does.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { MemoryR2 } from './r2-fake';
import { updateJson } from '../src/lib/r2Cas';
import { applyContentModeration } from '../src/lib/contentModeration';
import { setCommentHidden } from '../src/lib/aiModeration';
import { writeVerification } from '../src/lib/channelVerification';
import { saveTranslations, computeChecksum } from '../src/endpoints/i18n/translationsUpdate';
import { loadIndexCandidates } from '../src/lib/initializeIndices';

function sqlite(dir: string) {
  const raw = new DatabaseSync(':memory:');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
  let queries = 0;
  const prepare = (sql: string) => {
    queries++;
    let params: unknown[] = [];
    const st: any = {
      bind: (...v: unknown[]) => ((params = v.map((x) => (x === undefined ? null : x))), st),
      first: async () => {
        const row = raw.prepare(sql).get(...(params as any[])) as Record<string, unknown> | undefined;
        return row ? { ...row } : null;
      },
      all: async () => ({ results: raw.prepare(sql).all(...(params as any[])).map((r) => ({ ...r })) }),
      run: async () => raw.prepare(sql).run(...(params as any[])),
    };
    return st;
  };
  // D1 batch: the statements in order (one transaction on D1)
  const batch = async (statements: { run(): Promise<unknown> }[]) => {
    const out = [];
    for (const st of statements) out.push(await st.run());
    return out;
  };
  return { raw, prepare, batch, queries: () => queries };
}

/** A writer elsewhere (api-videos) appending a comment with a conditional write. */
const addComment = (bucket: MemoryR2, id: string, n: number) =>
  updateJson<any>(bucket, id, (video) => {
    if (!video) return undefined;
    video.comments = [...(video.comments ?? []), { id: `c${n}`, text: `comment ${n}` }];
    return video;
  }, { maxAttempts: 200 });

describe('conditional writes against concurrent writers', () => {
  it('AA-1: a ban during 150 concurrent comment writes keeps every comment and stays banned', async () => {
    const videos = new MemoryR2(4);
    videos.set('v1', { id: 'v1', title: 'T', comments: [] });
    await Promise.all([
      ...Array.from({ length: 150 }, (_, n) => addComment(videos, 'v1', n)),
      applyContentModeration(videos, 'v1', 'banned', { moderatorId: 'mod' }),
    ]);
    const video = videos.read('v1');
    assert.equal(video.comments.length, 150);
    assert.equal(video.isHidden, true);
    assert.equal(video.isDeleted, true);
  });

  it('AA-1: a missing document reports null and writes nothing', async () => {
    const videos = new MemoryR2();
    assert.equal(await applyContentModeration(videos, 'nope', 'removed', { moderatorId: 'mod' }), null);
    assert.equal(videos.data.size, 0);
  });

  it('AA-2: hiding a comment while 150 others are posted keeps all of them, and the hide sticks', async () => {
    const db = sqlite(join(__dirname, '..', 'migrations'));
    db.raw.exec(`INSERT INTO moderation_signals (id, subject_type, subject_id, parent_id, surface, author_id, channel_id, language,
      categories_json, top_category, top_score, models, prompt_version, decision, priority, review_status, created_at)
      VALUES ('s1', 'comment', 'bad', 'v1', 'video_comment', 'u1', 'ch1', 'en', '{}', 'S10', 1, 'm', 'p', 'would_flag', 60, 'pending', '2026-11-08')`);
    const videos = new MemoryR2(4);
    videos.set('v1', { id: 'v1', comments: [{ id: 'bad', text: 'abuse' }] });
    const [hide] = await Promise.all([
      setCommentHidden(db as any, videos, 's1', true, 'reviewer'),
      ...Array.from({ length: 150 }, (_, n) => addComment(videos, 'v1', n)),
    ]);
    assert.deepEqual(hide, { ok: true, changed: true });
    const video = videos.read('v1');
    assert.equal(video.comments.length, 151);
    assert.equal(video.comments.find((c: any) => c.id === 'bad').status, 'held');
  });

  it('AA-3: verification during 100 owner edits keeps every edit; 20 identical requests audit once', async () => {
    const db = sqlite(join(__dirname, '..', 'migrations'));
    const channels = new MemoryR2(4);
    channels.set('ch1', { id: 'ch1', name: 'Noor' });
    const edit = (n: number) =>
      updateJson<any>(channels, 'ch1', (ch) => (ch ? { ...ch, [`field${n}`]: n } : undefined), { maxAttempts: 200 });
    const verify = (i: number) =>
      writeVerification(db as any, channels, 'ch1', { verified: true, actorId: 'admin', now: '2026-11-09T00:00:00Z', id: `log${i}` });
    const results = await Promise.all([
      ...Array.from({ length: 100 }, (_, n) => edit(n)),
      ...Array.from({ length: 20 }, (_, i) => verify(i)),
    ]);
    const channel = channels.read('ch1');
    assert.equal(channel.isVerified, true);
    for (let n = 0; n < 100; n++) assert.equal(channel[`field${n}`], n);
    const writes = results.slice(100) as Array<{ changed: boolean } | null>;
    assert.equal(writes.filter((r) => r?.changed).length, 1);
    const audit = db.raw.prepare('SELECT COUNT(*) AS n FROM channel_verification_log').get() as { n: number };
    assert.equal(Number(audit.n), 1, 'one audit row for the one change');
  });

  it('AA-5: 40 admins saving both locales at once: every key survives and metadata checksums match the files', async () => {
    const bucket = new MemoryR2(3);
    await Promise.all(
      Array.from({ length: 40 }, (_, n) =>
        saveTranslations(bucket, n % 2 ? 'ar' : 'en', { section: { [`key${n}`]: `v${n}` } } as any, true, '2026-11-09T00:00:00Z'),
      ),
    );
    for (const locale of ['en', 'ar']) {
      const file = bucket.data.get(`translations/${locale}.json`)!;
      const keys = Object.keys(JSON.parse(file).translations.section);
      assert.equal(keys.length, 20, `${locale} keeps every admin's key`);
      assert.equal(bucket.read('translations/metadata.json').checksums[locale], computeChecksum(file));
    }
  });
});

describe('AA-4: section index rebuild reads a bounded amount', () => {
  it('5000 indexed videos: a fixed number of D1 queries, a bounded candidate set, correct top lists', async () => {
    const db = sqlite(join(__dirname, '..', '..', 'api-videos', 'migrations', 'search'));
    const insert = db.raw.prepare(
      'INSERT INTO search_videos (id, channel_id, visible, category, views, created_at, payload) VALUES (?, ?, ?, ?, ?, ?, ?)',
    );
    const now = Date.parse('2026-11-09T00:00:00Z');
    for (let i = 0; i < 5000; i++) {
      const created = now - i * 3_600_000; // one per hour back
      const category = `cat${i % 7}`;
      const payload = { id: `v${i}`, title: `Video ${i}`, views: (i * 7919) % 100000, likesCount: i % 50, category, channelId: 'ch', dateCreated: new Date(created).toISOString() };
      insert.run(`v${i}`, 'ch', i % 10 === 0 ? 0 : 1, category, payload.views, created, JSON.stringify(payload));
    }
    const before = db.queries();
    const { videos, categories } = await loadIndexCandidates(db as any, now);
    assert.equal(db.queries() - before, 7 + categories.length, 'one query per index');
    assert.equal(categories.length, 7);
    assert.ok(videos.length < 2500, `candidates bounded (${videos.length})`);
    // The newest visible video and the most viewed visible video are both candidates; hidden ones never are
    assert.ok(videos.some((v: any) => v.id === 'v1'));
    assert.ok(!videos.some((v: any) => v.id === 'v0'), 'not searchable, not indexed');
    const topViews = db.raw.prepare('SELECT id FROM search_videos WHERE visible = 1 ORDER BY views DESC LIMIT 1').get() as { id: string };
    assert.ok(videos.some((v: any) => v.id === topViews.id));
  });
});
