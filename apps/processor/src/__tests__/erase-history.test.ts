/**
 * GDPR erase gaps found by the strict leftover checks (#1253, #1254, #1255), on the real schemas:
 * admin history scrubbed and kept 2 years, an erased creator's archived titles replaced, dead letters
 * with hashed user ids, and the erase tombstone.
 */
import { join } from 'path';
import { createLogger } from '@al-ummah/logger';
import {
  ARCHIVE_TITLES_VERSION,
  archiveSubjectKey,
  archiveTitleOwnerIds,
  eraseArchiveTitles,
  eraseTombstoneKey,
  hashedUserId,
  hasArchiveTitles,
} from '@al-ummah/shared-types';
import { eraseUserAdminHistory, purgeExpiredAdminHistory } from '../erasure/admin-history';
import { eraseArchiveSubject } from '../erasure/archive-subjects';
import { ARCHIVE_TITLE_REF_RETENTION_MS, eraseArchiveTitlesPage, purgeExpiredTitleRefs, writeArchiveEntry } from '../erasure/archive-titles';
import { purgeExpiredTombstones, recordEraseTombstone } from '../erasure/tombstones';
import { processDeadLetterBatch } from '../dlq/consumer';
import { replayDeadLetter } from '../dlq/store';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

const SEARCH_MIGRATIONS_DIR = join(__dirname, '..', '..', '..', 'api-videos', 'migrations', 'search');
const CREATOR = 'usr_0123456789abcdef0123456789abcdef';
const VIEWER = 'usr_fedcba9876543210fedcba9876543210';
const ADMIN = 'usr_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa';
const MARKER = 'deleted-user';
const DAY = 24 * 60 * 60 * 1000;
const logger = createLogger('erase-history-test', { logLevel: 'error' });

function bucket() {
  const objects = new Map<string, { body: string; customMetadata?: Record<string, string>; httpMetadata?: Record<string, unknown> }>();
  return {
    objects,
    put: jest.fn(async (key: string, body: string, options?: { customMetadata?: Record<string, string>; httpMetadata?: Record<string, unknown> }) => {
      objects.set(key, { body, customMetadata: options?.customMetadata, httpMetadata: options?.httpMetadata });
    }),
    get: jest.fn(async (key: string) => {
      const o = objects.get(key);
      return o ? { text: async () => o.body, customMetadata: o.customMetadata, httpMetadata: o.httpMetadata } : null;
    }),
  };
}

const view = (id: string): AlUmmahMessage =>
  ({
    id,
    type: MessageType.VideoView,
    timestamp: Date.parse('2026-11-13T10:00:00Z'),
    payload: { videoId: 'vid_1', videoTitle: 'My lecture on fiqh', videoOwnerId: CREATOR, videoChannelId: 'ch_1', viewerId: VIEWER },
  }) as unknown as AlUmmahMessage;

const fanout = (id: string): AlUmmahMessage =>
  ({
    id,
    type: MessageType.NotificationFanout,
    timestamp: Date.parse('2026-11-13T10:00:00Z'),
    payload: { kind: 'new_video', channelId: 'ch_1', entityId: 'vid_1', params: { channelName: 'Creator', channelName_ar: 'المنشئ', videoTitle: 'Episode 1' }, actorUserId: CREATOR },
  }) as unknown as AlUmmahMessage;

describe('archive titles (#1254)', () => {
  it('finds titles and their owners; viewers are not owners', () => {
    expect(hasArchiveTitles(view('m').payload)).toBe(true);
    expect([...archiveTitleOwnerIds(view('m'))]).toEqual([CREATOR]);
    expect([...archiveTitleOwnerIds(fanout('m'))]).toEqual([CREATOR]);
    expect(archiveTitleOwnerIds({ payload: { videoId: 'v', viewerId: VIEWER } }).size).toBe(0);
    const erased = eraseArchiveTitles({ payload: { videoTitle: 'T', titleLocalized: { ar: 'ع' }, params: { channelName_ar: 'ق', streamTitle: 'Live' }, playlistTitle: 'P', other: 'kept' } });
    expect(erased).toEqual({
      payload: { videoTitle: 'erased video', titleLocalized: { ar: 'erased video' }, params: { channelName_ar: 'erased channel', streamTitle: 'erased video' }, playlistTitle: 'erased playlist', other: 'kept' },
    });
    expect(hasArchiveTitles(erased)).toBe(false);
  });

  it('indexes titled archive entries under the owner, and an erasure replaces them in R2', async () => {
    const db = createSqliteD1();
    const r2 = bucket();
    const env = { NOTIFICATIONS_DB: db, MESSAGES_BUCKET: r2 } as unknown as QueueEnvironment;
    await writeArchiveEntry(env, 'k1', view('m1'), { typeName: 'VideoView' }, { privacy: 'p', titles: ARCHIVE_TITLES_VERSION }, 1000);
    await writeArchiveEntry(env, 'k2', fanout('m2'), { typeName: 'NotificationFanout' }, { privacy: 'p' }, 1000);
    await writeArchiveEntry(env, 'k3', { ...view('m3'), payload: { videoId: 'v', viewerId: VIEWER } } as AlUmmahMessage, {}, {}, 1000);
    const subject = await archiveSubjectKey(CREATOR);
    expect(db.raw.prepare('SELECT subject, archive_key FROM archive_title_refs ORDER BY archive_key').all()).toEqual([
      { subject, archive_key: 'k1' },
      { subject, archive_key: 'k2' },
    ]);
    // The archive keeps the title until the erasure, and never a raw id
    expect(r2.objects.get('k1')!.body).toContain('My lecture on fiqh');
    expect(r2.objects.get('k1')!.body).not.toContain(CREATOR);

    const page = await eraseArchiveTitlesPage(db, r2, subject, 1);
    expect(page).toEqual({ rewritten: 1, missing: 0, more: true });
    expect(await eraseArchiveTitlesPage(db, r2, subject)).toEqual({ rewritten: 1, missing: 0, more: false });
    const k1 = r2.objects.get('k1')!;
    expect(k1.body).not.toContain('My lecture on fiqh');
    expect(JSON.parse(k1.body).payload.videoTitle).toBe('erased video');
    expect(k1.customMetadata).toEqual({ privacy: 'p', titles: ARCHIVE_TITLES_VERSION });
    const k2 = JSON.parse(r2.objects.get('k2')!.body);
    expect(k2.payload.params).toEqual({ channelName_ar: 'erased channel', videoTitle: 'erased video' });
    expect(db.raw.prepare('SELECT count(*) AS n FROM archive_title_refs').get()).toEqual({ n: 0 });
    // Idempotent; a ref whose object is gone is dropped
    db.raw.prepare("INSERT INTO archive_title_refs (subject, archive_key, created_at) VALUES (?, 'gone', 1)").run(subject);
    expect(await eraseArchiveTitlesPage(db, r2, subject)).toEqual({ rewritten: 0, missing: 1, more: false });
  });

  it('writes placeholders at once for an owner erased before the message arrived', async () => {
    const db = createSqliteD1();
    const r2 = bucket();
    await eraseArchiveSubject(db, CREATOR);
    await writeArchiveEntry({ NOTIFICATIONS_DB: db, MESSAGES_BUCKET: r2 } as unknown as QueueEnvironment, 'k1', fanout('m1'), {}, {});
    expect(JSON.parse(r2.objects.get('k1')!.body).payload.params.videoTitle).toBe('erased video');
    expect(db.raw.prepare('SELECT count(*) AS n FROM archive_title_refs').get()).toEqual({ n: 0 });
  });

  it('purges refs past the archive retention', async () => {
    const db = createSqliteD1();
    const now = 1_000 * DAY;
    db.raw.prepare("INSERT INTO archive_title_refs (subject, archive_key, created_at) VALUES ('s', 'old', ?), ('s', 'new', ?)").run(now - ARCHIVE_TITLE_REF_RETENTION_MS - 1, now);
    expect(await purgeExpiredTitleRefs(db, now)).toBe(1);
    expect(db.raw.prepare('SELECT archive_key FROM archive_title_refs').all()).toEqual([{ archive_key: 'new' }]);
  });

  it('UserDataErased queues the archive titles step (subject only), the tombstone and the admin scrub', async () => {
    const notifications = createSqliteD1();
    const reports = createSqliteD1(REPORTS_MIGRATIONS_DIR);
    const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
    const send = jest.fn();
    const env = {
      MESSAGE_QUEUE: { send },
      MESSAGES_BUCKET: bucket(),
      NOTIFICATIONS_DB: notifications,
      REPORTS_DB: reports,
      SEARCH_DB: search,
      MESSAGE_ARCHIVE: 'none',
      ENVIRONMENT: 'test',
      LOG_LEVEL: 'error',
    } as unknown as QueueEnvironment;
    const processor = new MessageProcessor(logger);
    const erase: AlUmmahMessage = { id: 'e1', type: MessageType.UserDataErased, timestamp: new Date().toISOString(), payload: { userId: CREATOR } };
    expect((await processor.processMessage(erase, env)).success).toBe(true);
    const step = send.mock.calls.map(([m]) => m).find((m) => m.type === MessageType.ArchiveTitlesErase);
    expect(step.payload).toEqual({ subject: await archiveSubjectKey(CREATOR) });
    expect(JSON.stringify(step)).not.toContain(CREATOR);
    expect(reports.raw.prepare('SELECT user_key FROM erased_users').all()).toEqual([{ user_key: await eraseTombstoneKey(CREATOR) }]);
    // The step itself, delivered
    expect((await processor.processMessage(step, env)).success).toBe(true);
  });
});

describe('admin history (#1253)', () => {
  function seed() {
    const search = createSqliteD1(SEARCH_MIGRATIONS_DIR);
    const deletion = (kind: string, id: string, title: string, owner: string | null, by: string, purgedAt: string | null, purgeBy: string | null = null) =>
      search.raw
        .prepare(
          'INSERT INTO admin_deletions (kind, target_id, title, owner_id, deleted_at, deleted_by, purge_requested_by, purged_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
        )
        .run(kind, id, title, owner, '2026-11-01T00:00:00.000Z', by, purgeBy, purgedAt);
    deletion('video', 'vid_1', 'My lecture', CREATOR, CREATOR, '2026-11-02T00:00:00.000Z');
    deletion('channel', 'ch_1', 'Creator channel', CREATOR, ADMIN, null, ADMIN);
    deletion('user', CREATOR, 'Creator Name <creator@example.com>', null, ADMIN, null, ADMIN);
    deletion('video', 'vid_2', 'Someone else', VIEWER, CREATOR, null, CREATOR);
    const job = (id: string, kind: string, targetKind: string, targetId: string, params: object, status: string, actor: string, links: string[]) => {
      search.raw
        .prepare(
          `INSERT INTO admin_jobs (id, kind, target_kind, target_id, params, status, attempts, result, actor_id, created_at, updated_at, finished_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?, '2026-11-01', '2026-11-01', ?)`
        )
        .run(id, kind, targetKind, targetId, JSON.stringify(params), status, JSON.stringify({ userId: params && (params as { userId?: string }).userId }), actor, status === 'running' ? null : '2026-11-02');
      for (const user of links) search.raw.prepare('INSERT INTO admin_job_users (user_id, job_id) VALUES (?, ?)').run(user, id);
    };
    job('j1', 'video.purge', 'video', 'vid_1', { userId: CREATOR, channelId: 'ch_1' }, 'succeeded', ADMIN, [CREATOR, ADMIN]);
    job('j2', 'user.delete-data', 'user', CREATOR, {}, 'running', ADMIN, [CREATOR, ADMIN]);
    job('j3', 'user.sync-holds', 'user', CREATOR, {}, 'succeeded', CREATOR, [CREATOR]);
    job('j4', 'channel.transfer', 'channel', 'ch_9', { newOwnerId: VIEWER, previousOwnerId: ADMIN }, 'succeeded', ADMIN, [VIEWER, ADMIN]);
    return search;
  }

  it('keeps the action records and replaces the erased account in them', async () => {
    const search = seed();
    const result = await eraseUserAdminHistory(search, CREATOR, MARKER);
    expect(result).toEqual({ deletions: 6, jobs: 3 });
    const deletions = search.raw.prepare('SELECT kind, target_id, title, owner_id, deleted_by, purge_requested_by FROM admin_deletions ORDER BY kind, target_id').all();
    expect(deletions).toEqual([
      { kind: 'channel', target_id: 'ch_1', title: 'erased channel', owner_id: MARKER, deleted_by: ADMIN, purge_requested_by: ADMIN },
      // The account's own row keeps its key (the purge and the run sweep find it by id)
      { kind: 'user', target_id: CREATOR, title: 'erased user', owner_id: null, deleted_by: ADMIN, purge_requested_by: ADMIN },
      { kind: 'video', target_id: 'vid_1', title: 'erased video', owner_id: MARKER, deleted_by: MARKER, purge_requested_by: null },
      { kind: 'video', target_id: 'vid_2', title: 'Someone else', owner_id: VIEWER, deleted_by: MARKER, purge_requested_by: MARKER },
    ]);
    const jobs = search.raw.prepare('SELECT id, target_id, params, result, actor_id FROM admin_jobs ORDER BY id').all();
    expect(jobs).toEqual([
      { id: 'j1', target_id: 'vid_1', params: JSON.stringify({ userId: MARKER, channelId: 'ch_1' }), result: JSON.stringify({ userId: MARKER }), actor_id: ADMIN },
      // Still running (the erasure itself): its target stays until it succeeds
      { id: 'j2', target_id: CREATOR, params: '{}', result: '{}', actor_id: ADMIN },
      { id: 'j3', target_id: MARKER, params: '{}', result: '{}', actor_id: MARKER },
      { id: 'j4', target_id: 'ch_9', params: JSON.stringify({ newOwnerId: VIEWER, previousOwnerId: ADMIN }), result: '{}', actor_id: ADMIN },
    ]);
    expect(search.raw.prepare('SELECT user_id, job_id FROM admin_job_users WHERE user_id = ?').all(CREATOR)).toEqual([{ user_id: CREATOR, job_id: 'j2' }]);
    // Nothing else names the account (its own row's key and the running job aside)
    const text = JSON.stringify([...deletions.map((d) => ({ ...d, target_id: d.kind === 'user' ? '' : d.target_id })), ...jobs.filter((j) => j.id !== 'j2')]);
    expect(text).not.toContain(CREATOR);
    expect(text).not.toContain('My lecture');
    expect(text).not.toContain('creator@example.com');
    // Idempotent
    expect(await eraseUserAdminHistory(search, CREATOR, MARKER)).toEqual({ deletions: 0, jobs: 1 });
  });

  it('purges history older than 2 years, never pending deletions or running jobs', async () => {
    const search = seed();
    const now = Date.parse('2028-11-03T00:00:00.000Z');
    expect(await purgeExpiredAdminHistory(search, now)).toEqual({ deletions: 1, jobs: 3 });
    expect(search.raw.prepare('SELECT target_id FROM admin_deletions ORDER BY target_id').all()).toEqual([{ target_id: 'ch_1' }, { target_id: CREATOR }, { target_id: 'vid_2' }]);
    expect(search.raw.prepare('SELECT id FROM admin_jobs').all()).toEqual([{ id: 'j2' }]);
    expect(search.raw.prepare('SELECT DISTINCT job_id FROM admin_job_users').all()).toEqual([{ job_id: 'j2' }]);
    expect(await purgeExpiredAdminHistory(search, Date.parse('2027-01-01T00:00:00.000Z'))).toEqual({ deletions: 0, jobs: 0 });
  });
});

describe('dead letters and late writes (#1255)', () => {
  const dead = (id: string, body: unknown) => ({ id, body, attempts: 1, ack: jest.fn(), retry: jest.fn() });

  it('stores hashed user ids (body and reason), refuses to replay them, keeps erasure steps raw', async () => {
    const db = createSqliteD1();
    const message = { id: 'm1', type: MessageType.ChannelSectionReorder, timestamp: 1, failureReason: `no channel for ${CREATOR}`, payload: { userId: CREATOR, channelId: 'c1', actor: { viewerId: VIEWER } } };
    const erasure = { id: 'm2', type: MessageType.UserDataErased, timestamp: 1, payload: { userId: CREATOR } };
    await processDeadLetterBatch({ queue: 'al-ummah-now-dlq-qa', messages: [dead('q1', message), dead('q2', erasure)] }, { NOTIFICATIONS_DB: db, ENVIRONMENT: 'qa' }, logger, 1000);
    const rows = db.raw.prepare('SELECT id, body_json, failure_reason, ids_hashed FROM dead_letters ORDER BY id').all() as Array<{ id: string; body_json: string; failure_reason: string; ids_hashed: number }>;
    expect(rows[0].body_json).not.toContain(CREATOR);
    expect(rows[0].body_json).not.toContain(VIEWER);
    expect(JSON.parse(rows[0].body_json).payload).toEqual({ userId: await hashedUserId(CREATOR), channelId: 'c1', actor: { viewerId: await hashedUserId(VIEWER) } });
    expect(rows[0].failure_reason).toBe(`no channel for ${await hashedUserId(CREATOR)}`);
    expect(rows[0].ids_hashed).toBe(1);
    expect(JSON.parse(rows[1].body_json).payload.userId).toBe(CREATOR);
    expect(rows[1].ids_hashed).toBe(0);
    const queue = { send: jest.fn() };
    expect(await replayDeadLetter(db, queue, 'q1')).toEqual({ status: 'not_replayable', reason: 'user ids are stored hashed (privacy)' });
    expect(await replayDeadLetter(db, queue, 'q2')).toEqual({ status: 'replayed', messageId: 'm2' });
  });

  it('records an erase tombstone keyed by hash and expires it after 30 days', async () => {
    const reports = createSqliteD1(REPORTS_MIGRATIONS_DIR);
    await recordEraseTombstone(reports, CREATOR, 1000);
    await recordEraseTombstone(reports, CREATOR, 2000);
    const rows = reports.raw.prepare('SELECT user_key, erased_at FROM erased_users').all();
    expect(rows).toEqual([{ user_key: await eraseTombstoneKey(CREATOR), erased_at: 2000 }]);
    expect(JSON.stringify(rows)).not.toContain(CREATOR);
    expect(await purgeExpiredTombstones(reports, 2000 + 29 * DAY)).toBe(0);
    expect(await purgeExpiredTombstones(reports, 2000 + 31 * DAY)).toBe(1);
  });
});
