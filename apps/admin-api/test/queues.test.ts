/**
 * Admin queues (docs/admin/QUEUES.md): the Action needed / History split, the
 * search query building, the per-tab counts and the names, for AI moderation
 * flags, contact messages and errors, on the real migrations (node:sqlite) and
 * a search index with the api-videos tables the names come from.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { sqliteD1 } from './d1-sqlite';
import { aiQueueOrder, aiQueueWhere, aiSearchCondition, aiLink, categoriesMatching, listAiQueue } from '../src/lib/queue/ai-queue';
import { contactQueueWhere, contactSearchCondition, listContactQueue } from '../src/lib/queue/contact-queue';
import { errorQueueWhere, listErrorQueue } from '../src/lib/queue/errors-queue';
import { clampPage, likePattern, resolveMe, type QueueFilters } from '../src/lib/queue/common';
import { matchIds, resolveNames } from '../src/lib/queue/names';
import { reviewSignal, setCommentHidden, type D1Like } from '../src/lib/aiModeration';
import { insertContactMessage, insertContactNote, recordDelivery, updateContactMessage } from '../src/lib/contact-store';
import { setErrorStatus } from '../src/lib/errors-store';
import { MemoryR2 } from './r2-fake';

const filters = (over: Partial<QueueFilters> = {}): QueueFilters => ({ tab: 'action', limit: 25, offset: 0, ...over });
const run = (db: D1Database, sql: string, ...args: unknown[]) => db.prepare(sql).bind(...args).run();

/** The search index tables the queues read (from the api-videos snapshot). */
function searchD1(): D1Database {
  const snapshot = readFileSync(join(process.cwd(), '..', 'api-videos', 'migrations', 'search.schema.snapshot.sql'), 'utf8');
  const wanted = ['content_ownership', 'admin_comments', 'search_posts'];
  const ddl = snapshot.split('\n').filter((line) => wanted.some((t) => line.startsWith(`CREATE TABLE ${t} (`)));
  assert.equal(ddl.length, wanted.length, 'search snapshot tables found');
  const raw = new DatabaseSync(':memory:');
  raw.exec(ddl.join('\n'));
  raw.exec(`
    INSERT INTO content_ownership (kind, id, admin_title, handle, email) VALUES
      ('profile', 'usr_author', 'Bilal Author', 'bilal', 'bilal@example.org'),
      ('profile', 'usr_mod', 'Maryam Moderator', 'maryam', 'maryam@example.org'),
      ('channel', 'ch1', 'Noor Channel', 'noor', NULL),
      ('video', 'v1', 'Tafsir of Surah Al-Kahf', NULL, NULL);
    INSERT INTO admin_comments (video_id, comment_id, user_id, channel_id, text) VALUES ('v1', 'c1', 'usr_author', 'ch1', 'a rude reply about the lecture');
    INSERT INTO search_posts (id, channel_id, payload) VALUES ('p1', 'ch1', '{"content":"Charity drive for the masjid"}');
  `);
  return sqliteD1Like(raw);
}

/** A D1 over an existing node:sqlite database (the shared helper always applies the admin migrations). */
function sqliteD1Like(raw: DatabaseSync): D1Database {
  const exec = (sql: string, args: unknown[]) => ({ results: raw.prepare(sql).all(...(args.map((a) => a ?? null) as never[])), success: true, meta: { changes: 0 } });
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...next: unknown[]) => statement(sql, next),
    first: async <T>() => (exec(sql, args).results[0] as T) ?? null,
    all: async () => exec(sql, args),
    run: async () => exec(sql, args),
    _exec: () => exec(sql, args),
  });
  return { prepare: (sql: string) => statement(sql), batch: async (list: { _exec(): unknown }[]) => list.map((s) => s._exec()) } as unknown as D1Database;
}

function signal(db: D1Database, over: Record<string, unknown>) {
  const row = {
    id: 's1', subject_type: 'comment', subject_id: 'c1', parent_id: 'v1', surface: 'video_comment', author_id: 'usr_author', channel_id: 'ch1',
    language: 'en', categories_json: '{"S10":0.9}', top_category: 'S10', top_score: 0.9, models: 'm', prompt_version: 'p', decision: 'would_flag',
    priority: 50, review_status: 'pending', created_at: '2026-11-08T10:00:00.000Z', ...over,
  };
  const keys = Object.keys(row);
  return run(db, `INSERT INTO moderation_signals (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...Object.values(row));
}

describe('queue helpers', () => {
  it('escapes LIKE wildcards, clamps pages and resolves "me"', () => {
    assert.equal(likePattern(' 100%_off\\ '), '%100\\%\\_off\\\\%');
    assert.deepEqual(clampPage(500, -3), { limit: 100, offset: 0 });
    assert.deepEqual(clampPage(undefined, 40), { limit: 25, offset: 40 });
    assert.equal(resolveMe('me', 'usr_me'), 'usr_me');
    assert.equal(resolveMe('usr_x', 'usr_me'), 'usr_x');
    assert.equal(resolveMe('', 'usr_me'), undefined);
  });
});

describe('AI moderation queue', () => {
  let db: D1Database;
  let search: D1Database;
  beforeEach(async () => {
    db = sqliteD1();
    search = searchD1();
    await signal(db, { id: 'old', created_at: '2026-11-01T10:00:00.000Z' });
    await signal(db, { id: 'new', created_at: '2026-11-05T10:00:00.000Z', priority: 90, top_category: 'spam', subject_type: 'post', subject_id: 'p1', parent_id: null, surface: 'community_post' });
    await signal(db, { id: 'safe', decision: 'none', review_status: 'n/a' });
    await signal(db, { id: 'reviewed', created_at: '2026-11-02T10:00:00.000Z' });
    await signal(db, { id: 'hidden', created_at: '2026-11-03T10:00:00.000Z', subject_id: 'c9' });
    await reviewSignal(db as unknown as D1Like, 'reviewed', 'agree', { id: 'usr_mod', email: 'maryam@example.org' }, undefined, new Date('2026-11-06T09:00:00.000Z'));
    const videos = new MemoryR2();
    videos.data.set('v1', JSON.stringify({ id: 'v1', comments: [{ id: 'c9', text: 'spam spam' }] }));
    await setCommentHidden(db as unknown as D1Like, videos as never, 'hidden', true, { id: 'usr_gone', email: 'old-admin@example.org' }, 'spam', new Date('2026-11-07T09:00:00.000Z'));
  });

  it('splits the tabs: pending and untouched → Action needed (oldest first); reviewed or hidden → History (newest first)', async () => {
    const action = await listAiQueue(db, search, filters());
    assert.deepEqual(action.items.map((i) => i.id), ['old', 'new']);
    assert.deepEqual(action.counts, { action: 2, history: 2 });
    assert.equal(action.total, 2);
    const history = await listAiQueue(db, search, filters({ tab: 'history' }));
    assert.deepEqual(history.items.map((i) => i.id), ['hidden', 'reviewed']);
    assert.equal(history.total, 2);
    assert.equal(history.items[0].handled?.outcome, 'hide');
  });

  it('rows carry names, not ids, and a link target; an unknown reviewer falls back to their email', async () => {
    const [old, post] = (await listAiQueue(db, search, filters())).items;
    assert.equal(old.subjectLabel, 'a rude reply about the lecture');
    assert.deepEqual(old.author, { id: 'usr_author', name: 'Bilal Author' });
    assert.deepEqual(old.channel, { id: 'ch1', name: 'Noor Channel' });
    assert.deepEqual(old.link, { kind: 'comment', id: 'c1', parentId: 'v1' });
    assert.equal(post.subjectLabel, 'Charity drive for the masjid');
    assert.deepEqual(post.link, { kind: 'post', id: 'p1', parentId: 'ch1' });
    const history = (await listAiQueue(db, search, filters({ tab: 'history' }))).items;
    assert.deepEqual(history.find((i) => i.id === 'reviewed')?.handled, { outcome: 'agree', by: { id: 'usr_mod', name: 'Maryam Moderator' }, at: '2026-11-06T09:00:00.000Z' });
    assert.deepEqual(history.find((i) => i.id === 'hidden')?.handled?.by, { id: 'usr_gone', name: 'old-admin@example.org' });
  });

  it('filters History by outcome, actor and the handled date; counts follow the filters', async () => {
    const agreed = await listAiQueue(db, search, filters({ tab: 'history', outcome: 'agree' }));
    assert.deepEqual(agreed.items.map((i) => i.id), ['reviewed']);
    assert.deepEqual(agreed.counts, { action: 2, history: 1 }, 'History-only filters leave the Action needed count alone');
    assert.deepEqual((await listAiQueue(db, search, filters({ tab: 'history', actor: 'usr_gone' }))).items.map((i) => i.id), ['hidden']);
    assert.deepEqual((await listAiQueue(db, search, filters({ tab: 'history', from: '2026-11-07', to: '2026-11-07' }))).items.map((i) => i.id), ['hidden']);
    const dated = await listAiQueue(db, search, filters({ from: '2026-11-04' }));
    assert.deepEqual(dated.items.map((i) => i.id), ['new'], 'Action needed dates are when the flag came in');
    const typed = await listAiQueue(db, search, filters({ type: 'community_post', category: 'spam' }));
    assert.deepEqual(typed.counts, { action: 1, history: 0 });
  });

  it('searches titles and text, author and channel names, and category names', async () => {
    const ids = async (q: string) => (await listAiQueue(db, search, filters({ q }))).items.map((i) => i.id);
    assert.deepEqual(await ids('rude reply'), ['old'], 'comment text');
    assert.deepEqual(await ids('masjid'), ['new'], 'post text');
    assert.deepEqual(await ids('bilal'), ['old', 'new'], 'author name');
    assert.deepEqual(await ids('Noor'), ['old', 'new'], 'channel name');
    assert.deepEqual(await ids('kahf'), ['old'], 'a comment on a matching video');
    assert.deepEqual(await ids('hate'), ['old'], 'category name → S10');
    assert.deepEqual(await ids('old'), ['old'], 'exact signal id');
    assert.deepEqual(await ids('nothing like this'), []);
    const counted = await listAiQueue(db, search, filters({ q: 'bilal' }));
    assert.deepEqual(counted.counts, { action: 2, history: 2 });
  });

  it('works without the search index: ids and categories only, no names', async () => {
    const page = await listAiQueue(db, undefined, filters({ q: 'S10' }));
    assert.deepEqual(page.items.map((i) => i.id), ['old']);
    assert.deepEqual(page.items[0].author, { id: 'usr_author', name: null });
  });

  it('sorts by priority when asked', async () => {
    assert.deepEqual((await listAiQueue(db, search, filters({ sort: 'priority' }))).items.map((i) => i.id), ['new', 'old']);
  });
});

describe('AI queue query building', () => {
  const none = { profiles: [], channels: [], videos: [], comments: [], posts: [] };

  it('maps search words to category codes', () => {
    assert.deepEqual(categoriesMatching('hate'), ['S10', 'sectarian_hate']);
    assert.deepEqual(categoriesMatching('s4'), ['S4']);
    assert.deepEqual(categoriesMatching('charity scam'), ['charity_scam']);
    assert.deepEqual(categoriesMatching('  '), []);
  });

  it('builds the search condition from exact ids, matched ids (json lists) and categories', () => {
    const plain = aiSearchCondition('abc', { ids: none, categories: [] });
    assert.equal(plain.sql, '(s.id = ? OR s.subject_id = ? OR s.author_id = ? OR s.channel_id = ?)');
    assert.deepEqual(plain.args, ['abc', 'abc', 'abc', 'abc']);
    const rich = aiSearchCondition('x', { ids: { ...none, profiles: ['u1'], comments: ['c1'], posts: ['p1'] }, categories: ['S10'] });
    assert.match(rich.sql, /s\.subject_id IN \(SELECT value FROM json_each\(\?\)\)/);
    assert.match(rich.sql, /s\.subject_type = 'post_comment' AND s\.parent_id IN/);
    assert.match(rich.sql, /s\.top_category IN \(\?\)/);
    assert.deepEqual(rich.args.slice(4), ['["c1","p1"]', '["p1"]', '["u1"]', 'S10']);
  });

  it('applies History-only filters to History and dates to each tab\'s own column', () => {
    const { action, history } = aiQueueWhere(filters({ tab: 'history', actor: 'usr_a', outcome: 'hide', from: '2026-11-01', type: 'video_comment' }));
    assert.deepEqual(action.sql, ['s.surface = ?', "s.review_status = 'pending' AND s.handled_at IS NULL", 's.created_at >= ?']);
    assert.deepEqual(history.sql, ['s.surface = ?', 's.handled_at IS NOT NULL', 's.handled_at >= ?', 's.handled_by_id = ?', 's.handled_action = ?']);
    assert.deepEqual(history.args, ['video_comment', '2026-11-01T00:00:00.000Z', 'usr_a', 'hide']);
    assert.equal(aiQueueOrder(filters()), 's.created_at ASC, s.id');
    assert.equal(aiQueueOrder(filters({ tab: 'history' })), 's.handled_at DESC, s.id');
  });

  it('links each subject type', () => {
    assert.deepEqual(aiLink({ subject_type: 'video', subject_id: 'v1', parent_id: null, channel_id: 'ch' }), { kind: 'video', id: 'v1' });
    assert.deepEqual(aiLink({ subject_type: 'post_comment', subject_id: 'pc', parent_id: 'p1', channel_id: 'ch' }), { kind: 'post', id: 'p1', parentId: 'ch' });
  });
});

describe('contact queue', () => {
  let db: D1Database;
  let search: D1Database;
  const roomy = { perIpHour: 99, perIpDay: 99, perUserHour: 99, perUserDay: 99 };
  const add = (id: string, at: string, over: Partial<{ name: string; email: string; message: string; topic: 'general' | 'account' }> = {}) =>
    insertContactMessage(db, { id, name: 'Amina', email: 'amina@example.org', topic: 'general', message: 'A question about playlists.', locale: 'en', pageUrl: null, userId: null, userAgent: null, ipHash: id, now: new Date(at), ...over }, roomy);
  const mod = { id: 'usr_mod', email: 'maryam@example.org' };

  beforeEach(async () => {
    db = sqliteD1();
    search = searchD1();
    await add('m-new', '2026-11-03T10:00:00.000Z');
    await add('m-open', '2026-11-01T10:00:00.000Z', { name: 'Yusuf', email: 'yusuf@example.org', topic: 'account', message: 'I cannot sign in to my account.' });
    await add('m-closed', '2026-11-02T10:00:00.000Z');
    await add('m-failed', '2026-11-02T12:00:00.000Z');
    await updateContactMessage(db, 'm-open', { status: 'open', assignee: mod }, new Date('2026-11-04T00:00:00.000Z'));
    await updateContactMessage(db, 'm-closed', { status: 'closed', actor: mod }, new Date('2026-11-05T00:00:00.000Z'));
    // Replied, but the reply finally failed: still needs an admin
    await insertContactNote(db, { id: 'n1', message_id: 'm-failed', kind: 'reply', body: 'Hello', author_id: 'usr_mod', author_email: 'maryam@example.org', email_to: 'amina@example.org', email_subject: 's', email_status: 'queued', email_id: null, created_at: '2026-11-06T00:00:00.000Z' });
    await recordDelivery(db, { messageId: 'm-failed', kind: 'reply', noteId: 'n1', status: 'sent', now: new Date('2026-11-06T00:00:00.000Z') });
    await recordDelivery(db, { messageId: 'm-failed', kind: 'ack', status: 'failed', error: 'bounce', now: new Date('2026-11-06T01:00:00.000Z') });
  });

  it('Action needed: new, open and failed deliveries, oldest first; History: the rest with who and when', async () => {
    const action = await listContactQueue(db, search, filters());
    assert.deepEqual(action.items.map((i) => i.id), ['m-open', 'm-failed', 'm-new']);
    assert.deepEqual(action.counts, { action: 3, history: 1 });
    assert.equal(action.items[1].sendFailed, true);
    assert.deepEqual(action.items[0].assignee, { id: 'usr_mod', name: 'Maryam Moderator' });
    assert.deepEqual(action.items[0].link, { kind: 'contact', id: 'm-open' });
    const history = await listContactQueue(db, search, filters({ tab: 'history' }));
    assert.deepEqual(history.items.map((i) => [i.id, i.handled]), [['m-closed', { outcome: 'closed', by: { id: 'usr_mod', name: 'Maryam Moderator' }, at: '2026-11-05T00:00:00.000Z' }]]);
  });

  it('a delivered reply records its author as the handler; re-saving the same status keeps the first handler', async () => {
    await recordDelivery(db, { messageId: 'm-failed', kind: 'ack', status: 'queued', now: new Date('2026-11-07T00:00:00.000Z') });
    const history = await listContactQueue(db, search, filters({ tab: 'history', outcome: 'replied' }));
    assert.deepEqual(history.items.map((i) => [i.id, i.handled?.by?.name, i.handled?.at]), [['m-failed', 'Maryam Moderator', '2026-11-06T00:00:00.000Z']]);
    await updateContactMessage(db, 'm-closed', { status: 'closed', actor: { id: 'usr_other', email: null } }, new Date('2026-11-08T00:00:00.000Z'));
    const closed = await listContactQueue(db, search, filters({ tab: 'history', outcome: 'closed' }));
    assert.equal(closed.items[0].handled?.by?.id, 'usr_mod');
  });

  it('searches sender name and email, message text and topic; filters by topic, assignee and actor', async () => {
    const ids = async (over: Partial<QueueFilters>) => (await listContactQueue(db, search, filters(over))).items.map((i) => i.id);
    assert.deepEqual(await ids({ q: 'yusuf' }), ['m-open']);
    assert.deepEqual(await ids({ q: 'sign in' }), ['m-open']);
    assert.deepEqual(await ids({ q: 'account' }), ['m-open'], 'topic');
    assert.deepEqual(await ids({ category: 'general' }), ['m-failed', 'm-new']);
    assert.deepEqual(await ids({ assignee: 'unassigned' }), ['m-failed', 'm-new']);
    assert.deepEqual(await ids({ assignee: 'usr_mod' }), ['m-open']);
    assert.deepEqual(await ids({ tab: 'history', actor: 'usr_mod' }), ['m-closed']);
    assert.deepEqual(await ids({ tab: 'history', actor: 'usr_other' }), []);
    const searched = await listContactQueue(db, search, filters({ q: 'amina' }));
    assert.deepEqual(searched.counts, { action: 2, history: 1 });
  });

  it('builds the search condition and tab clauses', () => {
    const s = contactSearchCondition(' Amina ');
    assert.deepEqual(s.args, ['%amina%', '%amina%', '%amina%', 'amina', 'Amina']);
    const { action, history } = contactQueueWhere(filters({ outcome: 'spam', actor: 'u', from: '2026-11-01' }));
    assert.ok(action.sql.includes("(m.status IN ('new', 'open') OR m.send_failed_at IS NOT NULL)"));
    assert.ok(action.sql.includes('m.created_at >= ?'));
    assert.ok(!action.sql.some((x) => x.includes('handled_by_id')));
    assert.ok(history.sql.includes('m.handled_at >= ?') && history.sql.includes('m.status = ?') && history.sql.includes('m.handled_by_id = ?'));
  });
});

describe('errors queue', () => {
  let db: D1Database;
  let search: D1Database;
  const group = (id: string, over: Record<string, unknown> = {}) => {
    const row = {
      id, fingerprint: id, environment: 'production', app: 'web', kind: 'unhandled', name: 'TypeError', message: `Cannot read ${id}`, status: 'new',
      occurrences: 1, users: 1, first_seen: '2026-11-01T00:00:00.000Z', last_seen: '2026-11-09T00:00:00.000Z', test: 0, updated_at: '2026-11-09T00:00:00.000Z', ...over,
    };
    const keys = Object.keys(row);
    return run(db, `INSERT INTO error_groups (${keys.join(',')}) VALUES (${keys.map(() => '?').join(',')})`, ...Object.values(row));
  };
  const mod = { id: 'usr_mod', email: 'maryam@example.org' };

  beforeEach(async () => {
    db = sqliteD1();
    search = searchD1();
    await group('eg_new', { first_seen: '2026-11-03T00:00:00.000Z', assignee_id: 'usr_author', assignee_email: 'bilal@example.org' });
    await group('eg_ack', { status: 'acknowledged', first_seen: '2026-11-02T00:00:00.000Z', app: 'admin-api' });
    await group('eg_resolved');
    await group('eg_ignored', { kind: 'fetch' });
    await group('eg_resolved_open');
    await group('eg_test', { test: 1 });
    await setErrorStatus(db, 'eg_resolved', 'resolved', mod, new Date('2026-11-05T00:00:00.000Z'));
    await setErrorStatus(db, 'eg_ignored', 'ignored', { id: 'usr_x', email: 'x@example.org' }, new Date('2026-11-06T00:00:00.000Z'));
    await setErrorStatus(db, 'eg_resolved_open', 'resolved', mod, new Date('2026-11-07T00:00:00.000Z'));
    await run(
      db,
      `INSERT INTO error_actions (id, group_id, environment, item_key, app, source, title, status, created_at, updated_at)
       VALUES ('act1', 'eg_resolved_open', 'production', 'dlq:1', 'processor', 'dlq', 'Dead letter', 'open', '2026-11-08', '2026-11-08')`,
    );
  });

  it('Action needed: new/acknowledged groups and any with an open item; History: resolved/ignored with who and when', async () => {
    const action = await listErrorQueue(db, search, filters());
    assert.deepEqual(action.items.map((i) => i.id), ['eg_resolved_open', 'eg_ack', 'eg_new']);
    assert.deepEqual(action.counts, { action: 3, history: 2 }, 'test groups left out');
    assert.equal(action.items[0].openActions, 1);
    assert.equal(action.items[0].handled, null);
    assert.deepEqual(action.items[2].assignee, { id: 'usr_author', name: 'Bilal Author' });
    const history = await listErrorQueue(db, search, filters({ tab: 'history' }));
    assert.deepEqual(history.items.map((i) => [i.id, i.handled]), [
      ['eg_ignored', { outcome: 'ignored', by: { id: 'usr_x', name: 'x@example.org' }, at: '2026-11-06T00:00:00.000Z' }],
      ['eg_resolved', { outcome: 'resolved', by: { id: 'usr_mod', name: 'Maryam Moderator' }, at: '2026-11-05T00:00:00.000Z' }],
    ]);
  });

  it('searches message and app; filters kind, outcome and actor; includes test groups on request', async () => {
    const ids = async (over: Partial<Parameters<typeof listErrorQueue>[2]>) => (await listErrorQueue(db, search, { ...filters(), ...over })).items.map((i) => i.id);
    assert.deepEqual(await ids({ q: 'admin-api' }), ['eg_ack']);
    assert.deepEqual(await ids({ q: 'eg_new' }), ['eg_new']);
    assert.deepEqual(await ids({ tab: 'history', type: 'fetch' }), ['eg_ignored']);
    assert.deepEqual(await ids({ tab: 'history', outcome: 'resolved' }), ['eg_resolved']);
    assert.deepEqual(await ids({ tab: 'history', actor: 'usr_mod' }), ['eg_resolved']);
    assert.deepEqual(await ids({ includeTest: true, q: 'eg_test' }), ['eg_test']);
    const { action, history } = errorQueueWhere({ ...filters(), app: 'web', from: '2026-11-01' });
    assert.ok(action.sql.includes('g.last_seen >= ?') && history.sql.includes('g.handled_at >= ?'));
  });
});

describe('names and id matching on the search index', () => {
  it('resolves every kind in one batch and matches typed names to ids', async () => {
    const search = searchD1();
    const names = await resolveNames(search, { profiles: ['usr_mod', 'nobody', null], channels: ['ch1'], videos: ['v1'], comments: ['c1'], posts: ['p1'] });
    assert.equal(names.profiles.get('usr_mod'), 'Maryam Moderator');
    assert.equal(names.profiles.has('nobody'), false);
    assert.equal(names.channels.get('ch1'), 'Noor Channel');
    assert.equal(names.videos.get('v1'), 'Tafsir of Surah Al-Kahf');
    assert.equal(names.posts.get('p1'), 'Charity drive for the masjid');
    const m = await matchIds(search, 'maryam');
    assert.deepEqual(m.profiles, ['usr_mod']);
    assert.deepEqual(await resolveNames(undefined, { profiles: ['usr_mod'] }).then((n) => n.profiles.size), 0);
  });
});

describe('migration 0019 backfill', () => {
  it('marks already-handled items with who and when', () => {
    const dir = join(process.cwd(), 'migrations');
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    const raw = new DatabaseSync(':memory:');
    for (const f of files.filter((x) => x < '0019')) raw.exec(readFileSync(join(dir, f), 'utf8'));
    raw.exec(`
      INSERT INTO moderation_signals (id, subject_type, subject_id, surface, decision, review_status, reviewer_id, reviewer_decision, reviewed_at, created_at)
        VALUES ('a', 'comment', 'c', 'video_comment', 'flag', 'agreed', 'usr_r', 'agree', '2026-11-02', '2026-11-01'),
               ('h', 'comment', 'c2', 'video_comment', 'flag', 'pending', NULL, NULL, NULL, '2026-11-01'),
               ('p', 'comment', 'c3', 'video_comment', 'flag', 'pending', NULL, NULL, NULL, '2026-11-01');
      INSERT INTO moderation_actions (id, signal_id, action, actor_type, actor_id, created_at) VALUES
        ('x1', 'a', 'agree', 'user', 'usr_r', '2026-11-02'), ('x2', 'h', 'hide', 'user', 'usr_h', '2026-11-03'), ('x3', 'p', 'flag', 'ai', NULL, '2026-11-01');
      INSERT INTO contact_messages (id, status, topic, name, email, message, ip_hash, created_at, updated_at)
        VALUES ('r', 'replied', 'general', 'n', 'e@x.org', 'm', 'i', '2026-11-01', '2026-11-04'), ('c', 'closed', 'general', 'n', 'e@x.org', 'm', 'i', '2026-11-01', '2026-11-05');
      INSERT INTO contact_notes (id, message_id, kind, body, author_id, author_email, created_at) VALUES ('n', 'r', 'reply', 'b', 'usr_c', 'c@x.org', '2026-11-03');
      INSERT INTO error_groups (id, fingerprint, environment, app, kind, message, status, first_seen, last_seen, updated_at, resolved_at)
        VALUES ('g', 'f', 'production', 'web', 'unhandled', 'm', 'resolved', '2026-11-01', '2026-11-01', '2026-11-06', '2026-11-06');
      INSERT INTO error_group_activity (id, group_id, kind, from_status, to_status, actor_id, actor_email, created_at) VALUES ('ga', 'g', 'status', 'new', 'resolved', 'usr_e', 'e@x.org', '2026-11-06');
    `);
    raw.exec(readFileSync(join(dir, files.find((f) => f.startsWith('0019_'))!), 'utf8'));
    const all = (sql: string) => raw.prepare(sql).all().map((r) => ({ ...r }));
    assert.deepEqual(all('SELECT id, handled_action, handled_by_id, handled_at FROM moderation_signals ORDER BY id'), [
      { id: 'a', handled_action: 'agree', handled_by_id: 'usr_r', handled_at: '2026-11-02' },
      { id: 'h', handled_action: 'hide', handled_by_id: 'usr_h', handled_at: '2026-11-03' },
      { id: 'p', handled_action: null, handled_by_id: null, handled_at: null },
    ]);
    assert.deepEqual(all('SELECT id, handled_by_id, handled_by_email, handled_at FROM contact_messages ORDER BY id'), [
      { id: 'c', handled_by_id: null, handled_by_email: null, handled_at: '2026-11-05' },
      { id: 'r', handled_by_id: 'usr_c', handled_by_email: 'c@x.org', handled_at: '2026-11-03' },
    ]);
    assert.deepEqual(all('SELECT handled_by_id, handled_at FROM error_groups'), [{ handled_by_id: 'usr_e', handled_at: '2026-11-06' }]);
  });
});
