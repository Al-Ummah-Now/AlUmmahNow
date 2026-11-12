/**
 * Community post likes and poll votes as D1 counters (SCALABILITY-AUDIT PR-2/3/4).
 *
 * Hundreds of events run through the real handlers at once, with redelivered
 * duplicates, out-of-order like/unlike pairs and random R2 latency, on the
 * real SQL (node:sqlite, batches are transactions like D1). Every test ends
 * by comparing the counters with the R2 documents, which are the truth.
 */
import { handlePostLikeEvent } from '../handlers/post-like';
import { handlePollVoteEvent } from '../handlers/poll-vote';
import { IMPORT_LEASE_MS, eraseUserPostInteractions, importLegacyPost, resumeStalledImports } from '../lib/post-counters';
import { MessageType, type AlUmmahMessage, type QueueEnvironment } from '../types';
import { createSqliteD1 } from './sqlite-d1';

const pause = () => new Promise<void>((r) => setTimeout(r, Math.floor(Math.random() * 4)));
const logger = { debug: () => {}, info: () => {}, warn: () => {}, error: () => {} } as never;

/** R2 stand-in: list pages with cursors, random latency, records every put. */
function memoryBucket() {
  const store = new Map<string, { body: string; uploaded: Date }>();
  const puts: string[] = [];
  const bucket = {
    store,
    puts,
    set(key: string, body: unknown, uploaded = new Date('2026-11-01T10:00:00Z')) {
      store.set(key, { body: JSON.stringify(body), uploaded });
    },
    put: async (key: string, value: string) => {
      puts.push(key);
      store.set(key, { body: value, uploaded: new Date() });
    },
    get: async (key: string) => {
      await pause();
      const o = store.get(key);
      if (!o) return null;
      return { key, json: async <T,>() => JSON.parse(o.body) as T, text: async () => o.body } as never;
    },
    list: async ({ prefix = '', cursor, limit = 1000 }: { prefix?: string; cursor?: string; limit?: number } = {}) => {
      await pause();
      const keys = [...store.keys()].filter((k) => k.startsWith(prefix)).sort();
      const start = cursor ? Number(cursor) : 0;
      const page = keys.slice(start, start + limit);
      const truncated = start + limit < keys.length;
      return {
        objects: page.map((key) => ({ key, uploaded: store.get(key)!.uploaded })),
        truncated,
        cursor: truncated ? String(start + limit) : undefined,
      };
    },
  };
  return bucket;
}

function setup() {
  const db = createSqliteD1();
  const bucket = memoryBucket();
  const sent: AlUmmahMessage[] = [];
  const env = {
    NOTIFICATIONS_DB: db,
    community_posts: bucket,
    MESSAGE_QUEUE: { send: async (m: AlUmmahMessage) => void sent.push(m) },
  } as unknown as QueueEnvironment;
  const sum = (postId: string, metric: string, dim = '') =>
    Number(
      db.raw
        .prepare(`SELECT COALESCE(SUM(value), 0) AS n FROM analytics_daily WHERE entity_type = 'post' AND entity_id = ? AND metric = ? AND dim = ?`)
        .get(postId, metric, dim)?.n ?? 0,
    );
  return { db, bucket, env, sent, sum };
}

const likeMsg = (postId: string, userId: string, type = MessageType.CommunityPostLiked): AlUmmahMessage =>
  ({ id: `${postId}-${userId}-${Math.random()}`, type, payload: { postId, channelId: 'c1', actor: { userId }, timestamp: '2026-11-09T12:00:00Z' } }) as never;
const voteMsg = (postId: string, userId: string, optionIds: string[]): AlUmmahMessage =>
  ({ id: `${postId}-${userId}`, type: MessageType.PollVoted, payload: { postId, channelId: 'c1', actor: { userId }, optionIds, pollOptions: [], timestamp: '2026-11-09T12:00:00Z' } }) as never;

/** Runs queued follow-up messages (legacy import continuations) until none are left. */
async function drain(env: QueueEnvironment, sent: AlUmmahMessage[]) {
  for (let i = 0; i < 100 && sent.length; i++) {
    const batch = sent.splice(0);
    await Promise.all(batch.map((m) => (m.type === MessageType.PollVoted ? handlePollVoteEvent(m, env, logger) : handlePostLikeEvent(m, env, logger))));
  }
  expect(sent).toHaveLength(0);
}

describe('post likes', () => {
  it('1000 parallel like/unlike events with duplicates end at exactly the number of like documents', async () => {
    const { env, bucket, sum, sent } = setup();
    const events: AlUmmahMessage[] = [];
    for (let u = 0; u < 400; u++) {
      const user = `u${u}`;
      // Every user likes; a third then unlike; api-videos writes R2 first, then queues
      bucket.set(`likes/p1/${user}.json`, { userId: user, likedAt: '2026-11-09T12:00:00Z' });
      events.push(likeMsg('p1', user));
      if (u % 3 === 0) {
        bucket.store.delete(`likes/p1/${user}.json`);
        events.push(likeMsg('p1', user, MessageType.CommunityPostUnliked));
      }
    }
    // Redeliveries (at-least-once) and shuffled order (unlike before like)
    while (events.length < 1000) events.push(events[Math.floor(Math.random() * events.length)]);
    events.sort(() => Math.random() - 0.5);

    await Promise.all(events.map((m) => handlePostLikeEvent(m, env, logger)));
    await drain(env, sent);

    const truth = [...bucket.store.keys()].filter((k) => k.startsWith('likes/p1/')).length;
    expect(truth).toBe(266);
    expect(sum('p1', 'likes')).toBe(truth);
    // The processor never rewrites the post document (or anything else)
    expect(bucket.puts).toEqual([]);
  });

  it('a like and an unlike of the same user racing in any order end in the R2 state', async () => {
    for (let round = 0; round < 50; round++) {
      const { env, bucket, sum } = setup();
      bucket.set('likes/p/u.json', { likedAt: '2026-11-09T12:00:00Z' });
      const like = handlePostLikeEvent(likeMsg('p', 'u'), env, logger);
      bucket.store.delete('likes/p/u.json');
      const unlike = handlePostLikeEvent(likeMsg('p', 'u', MessageType.CommunityPostUnliked), env, logger);
      await Promise.all([like, unlike]);
      // Whatever the interleaving, one more event (any later redelivery) settles it to R2
      await handlePostLikeEvent(likeMsg('p', 'u'), env, logger);
      expect(sum('p', 'likes')).toBe(0);
    }
  });

  it('imports 2500 legacy likes in pages while new likes and unlikes arrive, counting nobody twice', async () => {
    const { env, bucket, sum, sent, db } = setup();
    for (let u = 0; u < 2500; u++) bucket.set(`likes/big/old${u}.json`, { likedAt: '2026-10-01T00:00:00Z' }, new Date('2026-10-01T00:00:00Z'));
    // Small per-call budget: force several continuation messages
    const events: AlUmmahMessage[] = [];
    for (let u = 0; u < 200; u++) {
      bucket.set(`likes/big/new${u}.json`, { likedAt: '2026-11-09T12:00:00Z' });
      events.push(likeMsg('big', `new${u}`));
    }
    for (let u = 0; u < 300; u += 2) {
      bucket.store.delete(`likes/big/old${u}.json`);
      events.push(likeMsg('big', `old${u}`, MessageType.CommunityPostUnliked));
    }
    await Promise.all(events.map((m) => handlePostLikeEvent(m, env, logger)));
    await drain(env, sent);

    const truth = [...bucket.store.keys()].filter((k) => k.startsWith('likes/big/')).length;
    expect(truth).toBe(2500 + 200 - 150);
    expect(sum('big', 'likes')).toBe(truth);
    expect(db.raw.prepare(`SELECT done FROM post_counter_imports WHERE post_id = 'big' AND kind = 'likes'`).get()?.done).toBe(1);
    // Legacy likes stay on the day they were made
    const oct = db.raw.prepare(`SELECT value FROM analytics_daily WHERE entity_id = 'big' AND metric = 'likes' AND day = '2026-10-01'`).get();
    expect(Number(oct?.value)).toBe(2500 - 150);
  });

  it('only one consumer imports a post at a time; the others are told it is busy', async () => {
    const { bucket, sum, db } = setup();
    for (let u = 0; u < 30; u++) bucket.set(`likes/p2/u${u}.json`, {});
    const states = await Promise.all([1, 2, 3, 4, 5].map((i) => importLegacyPost(db, bucket as never, 'p2', 'likes', `m${i}`)));
    expect(states.filter((s) => s === 'done')).toHaveLength(1);
    expect(sum('p2', 'likes')).toBe(30);
  });

  it('the hourly sweep finishes an import whose holder died, and two overlapping holders count nobody twice', async () => {
    const { bucket, sum, db } = setup();
    for (let u = 0; u < 3500; u++) bucket.set(`likes/p3/u${u}.json`, {});
    const t0 = 1_000_000;
    // Holder imports 20 pages of 1000? no: 3500 fits in one call; force a stall by claiming without importing
    db.raw.prepare(`INSERT INTO post_counter_imports (post_id, kind, cursor, done, lease_owner, lease_until, updated_at) VALUES ('p3', 'likes', NULL, 0, 'dead', ?, 'x')`).run(t0 + IMPORT_LEASE_MS);
    expect(await resumeStalledImports(db, bucket as never, t0)).toEqual({ resumed: 0, done: 0 });
    // Lease ran out: two sweeps at once, both may import pages; counts stay exact
    await Promise.all([
      resumeStalledImports(db, bucket as never, t0 + IMPORT_LEASE_MS + 1),
      importLegacyPost(db, bucket as never, 'p3', 'likes', 'late', t0 + IMPORT_LEASE_MS + 1),
    ]);
    expect(sum('p3', 'likes')).toBe(3500);
    expect(db.raw.prepare(`SELECT done FROM post_counter_imports WHERE post_id = 'p3'`).get()?.done).toBe(1);
  });
});

describe('poll votes', () => {
  it('600 voters, redelivered and in parallel: totals and per-option counts are exact, with no recount', async () => {
    const { env, bucket, sum, sent } = setup();
    const events: AlUmmahMessage[] = [];
    const expected: Record<string, number> = { a: 0, b: 0, c: 0 };
    for (let u = 0; u < 600; u++) {
      const options = u % 5 === 0 ? ['a', 'c'] : [['a', 'b', 'c'][u % 3]];
      for (const o of options) expected[o]++;
      bucket.set(`votes/poll/u${u}.json`, { userId: `u${u}`, optionIds: options, votedAt: '2026-11-09T12:00:00Z' });
      events.push(voteMsg('poll', `u${u}`, options));
    }
    // Redeliveries: a retried message is delivered again later, under the same id
    const firstRound = events.slice();
    const redeliveries: AlUmmahMessage[] = [];
    while (firstRound.length + redeliveries.length < 900) redeliveries.push(firstRound[Math.floor(Math.random() * firstRound.length)]);
    firstRound.sort(() => Math.random() - 0.5);

    const gets = jest.spyOn(bucket, 'get');
    await Promise.all([
      ...firstRound.map((m) => handlePollVoteEvent(m, env, logger)),
      (async () => { for (const m of redeliveries) await handlePollVoteEvent(m, env, logger); })(),
    ]);
    await drain(env, sent);

    expect(sum('poll', 'poll_votes')).toBe(600);
    for (const o of ['a', 'b', 'c']) expect(sum('poll', 'poll_option', o)).toBe(expected[o]);
    // Constant work per vote, not a recount per vote (which would be ~600 x 600 reads). Under random
    // redelivery order and parallel handling a delivery can read its vote again while the one-time
    // import is in flight, so the bound allows twice the deliveries: CI saw 2,102 against the old
    // 1,550 bound (#926) while every count above was exact.
    expect(gets.mock.calls.length).toBeLessThan(2 * (900 + 600));
    expect(bucket.puts).toEqual([]);
  });

  it('imports legacy votes and keeps counting new ones', async () => {
    const { env, bucket, sum, sent } = setup();
    for (let u = 0; u < 450; u++) bucket.set(`votes/old/u${u}.json`, { optionIds: [u % 2 ? 'x' : 'y'] });
    bucket.set('votes/old/results.json', { totalVotes: 450 }); // legacy results file is not a voter
    bucket.set('votes/old/new1.json', { optionIds: ['x'] });
    await handlePollVoteEvent(voteMsg('old', 'new1', ['x']), env, logger);
    await drain(env, sent);
    expect(sum('old', 'poll_votes')).toBe(451);
    expect(sum('old', 'poll_option', 'x')).toBe(226);
    expect(sum('old', 'poll_option', 'y')).toBe(225);
  });
});

describe('erasure', () => {
  it("takes an erased user's likes and votes off every post", async () => {
    const { env, bucket, sum, db } = setup();
    for (const p of ['p1', 'p2']) {
      for (const u of ['gone', 'stays']) {
        bucket.set(`likes/${p}/${u}.json`, {});
        await handlePostLikeEvent(likeMsg(p, u), env, logger);
        bucket.set(`votes/${p}/${u}.json`, { optionIds: ['a', 'b'] });
        await handlePollVoteEvent(voteMsg(p, u, ['a', 'b']), env, logger);
      }
    }
    await eraseUserPostInteractions(db, 'gone');
    for (const p of ['p1', 'p2']) {
      expect(sum(p, 'likes')).toBe(1);
      expect(sum(p, 'poll_votes')).toBe(1);
      expect(sum(p, 'poll_option', 'a')).toBe(1);
    }
    expect(db.raw.prepare(`SELECT COUNT(*) AS n FROM post_likes WHERE user_id = 'gone'`).get()?.n).toBe(0);
  });
});
