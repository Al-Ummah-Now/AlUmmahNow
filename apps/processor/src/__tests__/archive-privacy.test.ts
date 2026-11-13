/**
 * #1177: the queue-message archive keeps no raw user id and no free text, and an account erasure
 * cuts its archived events off from the person.
 */
import { createLogger } from '@al-ummah/logger';
import {
  ARCHIVE_ERASED_MARKER,
  ARCHIVE_PRIVACY_VERSION,
  archiveRecordNeedsScrub,
  collectArchiveUserIds,
  scrubArchiveRecord,
} from '@al-ummah/shared-types';
import { archivePseudonyms, eraseArchiveSubject } from '../erasure/archive-subjects';
import { MessageProcessor } from '../messageProcessor';
import { AlUmmahMessage, MessageType, QueueEnvironment } from '../types';
import { createSqliteD1, REPORTS_MIGRATIONS_DIR } from './sqlite-d1';

const ALICE = 'usr_0123456789abcdef0123456789abcdef';
const BOB = 'usr_fedcba9876543210fedcba9876543210';
const logger = createLogger({ service: 'test', level: 'error' } as never);

const message = (type: MessageType, payload: Record<string, unknown>): AlUmmahMessage =>
  ({ id: `m-${Math.random().toString(36).slice(2)}`, type, timestamp: Date.parse('2026-11-13T10:00:00Z'), payload }) as unknown as AlUmmahMessage;

function envWith(notifications = createSqliteD1()) {
  const puts: Array<{ key: string; body: string }> = [];
  const env = {
    MESSAGES_BUCKET: { put: jest.fn(async (key: string, body: string) => void puts.push({ key, body })) },
    NOTIFICATIONS_DB: notifications,
    REPORTS_DB: createSqliteD1(REPORTS_MIGRATIONS_DIR),
    MESSAGE_ARCHIVE: 'all',
    ENVIRONMENT: 'test',
    LOG_LEVEL: 'error',
  } as unknown as QueueEnvironment;
  return { env, puts, notifications };
}

describe('scrubArchiveRecord', () => {
  it('pseudonymises person ids anywhere and drops free text and device details', () => {
    const record = {
      payload: {
        reportId: 'r1',
        reporterId: ALICE,
        reason: 'spam',
        description: 'He is my neighbour, call me on 0123',
        actor: { userId: BOB, channelId: 'c1' },
        targetId: ALICE,
        userAgent: 'Mozilla/5.0',
        referrer: 'https://www.google.com/search?q=alice+smith',
        events: [{ name: 'vitals', url: 'https://alummahnow.net/en/watch?v=1&email=a@b.co', value: 1 }],
        note: 'mail alice@example.org',
        videoTitle: 'Lecture by alice@example.org',
      },
    };
    const ids = collectArchiveUserIds(record);
    expect([...ids].sort()).toEqual([ALICE, BOB].sort());
    const pseudonyms = new Map([[ALICE, 'ps_' + 'a'.repeat(32)], [BOB, 'ps_' + 'b'.repeat(32)]]);
    const out = scrubArchiveRecord(record, { pseudonyms });
    const text = JSON.stringify(out);
    expect(text).not.toContain(ALICE);
    expect(text).not.toContain(BOB);
    expect(text).not.toContain('neighbour');
    expect(text).not.toContain('Mozilla');
    expect(text).not.toContain('alice');
    expect(text).not.toContain('a@b.co');
    expect(out.payload.reporterId).toBe('ps_' + 'a'.repeat(32));
    expect(out.payload.targetId).toBe('ps_' + 'a'.repeat(32));
    expect(out.payload.actor).toEqual({ userId: 'ps_' + 'b'.repeat(32), channelId: 'c1' });
    expect(out.payload.referrer).toBe('www.google.com');
    expect(out.payload.events[0]).toEqual({ name: 'vitals', url: 'https://alummahnow.net/en/watch', value: 1 });
    expect(out.payload.reason).toBe('spam');
    expect(out.payload.videoTitle).toBe('Lecture by [email]');
  });

  it('writes the erased marker for erasure messages and leaves pseudonyms alone', () => {
    expect(scrubArchiveRecord({ payload: { userId: ALICE } }, { pseudonyms: new Map(), erased: true })).toEqual({ payload: { userId: ARCHIVE_ERASED_MARKER } });
    const done = { payload: { userId: 'ps_' + 'c'.repeat(32) }, privacy: ARCHIVE_PRIVACY_VERSION };
    expect(archiveRecordNeedsScrub(done)).toBe(false);
    expect(archiveRecordNeedsScrub({ payload: { userId: 'ps_' + 'c'.repeat(32) } })).toBe(false);
    expect(archiveRecordNeedsScrub({ payload: { viewerId: ALICE } })).toBe(true);
    expect(archiveRecordNeedsScrub({ payload: { description: 'x' } })).toBe(true);
  });
});

describe('archive pseudonym secrets', () => {
  it('gives each person a stable pseudonym, keeps no raw id, and erasure ends it', async () => {
    const db = createSqliteD1();
    const first = await archivePseudonyms(db, [ALICE, BOB]);
    const again = await archivePseudonyms(db, [ALICE]);
    expect(first.get(ALICE)).toMatch(/^ps_[0-9a-f]{32}$/);
    expect(again.get(ALICE)).toBe(first.get(ALICE));
    expect(first.get(BOB)).not.toBe(first.get(ALICE));
    const rows = db.raw.prepare('SELECT * FROM archive_subjects').all();
    expect(rows).toHaveLength(2);
    expect(JSON.stringify(rows)).not.toContain(ALICE.slice(4));

    expect(await eraseArchiveSubject(db, ALICE)).toBe(1);
    expect(await eraseArchiveSubject(db, ALICE)).toBe(1);
    const erased = db.raw.prepare('SELECT secret, erased_at FROM archive_subjects WHERE secret IS NULL').all();
    expect(erased).toHaveLength(1);
    // Later messages about the erased account archive the marker, not a new pseudonym
    expect((await archivePseudonyms(db, [ALICE])).get(ALICE)).toBe(ARCHIVE_ERASED_MARKER);
    expect((await archivePseudonyms(db, [BOB])).get(BOB)).toBe(first.get(BOB));
    expect(db.raw.prepare('SELECT COUNT(*) AS n FROM archive_subjects').get()).toEqual({ n: 2 });
  });
});

describe('the processor archive', () => {
  it('stores pseudonyms and no free text, and erasure messages without the id', async () => {
    const { env, puts, notifications } = envWith();
    const processor = new MessageProcessor(logger);
    await processor.processMessage(
      message(MessageType.ReportCreate, { reportId: 'r1', entityType: 'video', entityId: 'v1', reporterId: ALICE, reason: 'spam', description: 'private words', timestamp: '2026-11-13T10:00:00Z' }),
      env
    );
    await processor.processMessage(message(MessageType.UserDataErased, { userId: ALICE, timestamp: '2026-11-13T10:01:00Z' }), env);

    const archived = puts.filter((p) => /^\d{4}-\d{2}-\d{2}T/.test(p.key));
    expect(archived.length).toBeGreaterThanOrEqual(2);
    for (const entry of archived) {
      expect(entry.body).not.toContain(ALICE);
      expect(entry.body).not.toContain('private words');
      expect(JSON.parse(entry.body).privacy).toBe(ARCHIVE_PRIVACY_VERSION);
    }
    const erase = archived.map((p) => JSON.parse(p.body)).find((r) => r.type === MessageType.UserDataErased);
    expect(erase.payload.userId).toBe(ARCHIVE_ERASED_MARKER);
    // The erasure cleared the secret the report's pseudonym was made with
    expect(notifications.raw.prepare('SELECT COUNT(*) AS n FROM archive_subjects WHERE secret IS NOT NULL').get()).toEqual({ n: 0 });
  });
});
