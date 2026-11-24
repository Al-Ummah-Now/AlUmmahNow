/** Holding live chat messages for review (wiki E17-D4), inside Epic 28's rules. No AI is called. */
import { DatabaseSync } from 'node:sqlite';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type { ModerationCategory, ModerationCategoryPolicy } from '@al-ummah/shared-types';
import { holdLevel, holdLiveChatMessage } from '../moderation/live-chat';

const policy = (over: Partial<ModerationCategoryPolicy> = {}): ModerationCategoryPolicy => ({ mode: 'enforce', threshold: 0.8, action: 'flag', enabled: true, ...over });
const policies = (category: string, over: Partial<ModerationCategoryPolicy> = {}) => ({ [category]: policy(over) }) as Partial<Record<ModerationCategory, ModerationCategoryPolicy>>;

describe('what scores hold', () => {
  it.each([
    ['flagged', { spam: 0.8 }, policies('spam'), 'basic'],
    ['an enforced hide too', { spam: 0.95 }, policies('spam', { action: 'hide' }), 'basic'],
    ['close to the threshold', { spam: 0.65 }, policies('spam'), 'strict'],
    ['further away', { spam: 0.64 }, policies('spam'), null],
    ['shadow mode never', { spam: 1 }, policies('spam', { mode: 'shadow' }), null],
    ['a category that is off', { spam: 1 }, policies('spam', { enabled: false }), null],
    ['a category without an action', { spam: 1 }, policies('spam', { action: 'none' }), null],
    ['religious authenticity never, even enforced', { religious_authenticity: 1 }, policies('religious_authenticity'), null],
    ['a category nobody set up', { harassment: 1 }, policies('spam'), null],
    ['clean, with a low threshold', { spam: 0 }, policies('spam', { threshold: 0.1 }), null],
    ['the stronger one counts', { spam: 0.7, harassment: 0.9 }, { ...policies('spam'), ...policies('harassment') }, 'basic'],
  ] as const)('%s', (_name, scores, p, level) => {
    expect(holdLevel(scores as unknown as Record<string, number>, p)).toBe(level);
  });
});

describe('holding', () => {
  const sent: Array<{ channel: string; message: { type: string; data: Record<string, unknown> } }> = [];
  const realFetch = globalThis.fetch;
  beforeEach(() => {
    sent.length = 0;
    globalThis.fetch = (async (_u: string, init?: RequestInit) => { sent.push(JSON.parse(String(init?.body))); return Response.json({}); }) as never;
  });
  afterAll(() => { globalThis.fetch = realFetch; });

  function setup(aiHold: string) {
    const raw = new DatabaseSync(':memory:');
    const dir = join(__dirname, '../../../api-videos/migrations/search');
    for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) raw.exec(readFileSync(join(dir, f), 'utf8'));
    raw.prepare('INSERT INTO live_stream_metadata (stream_id, ai_hold) VALUES (?, ?)').run('s1', aiHold);
    const put = (id: string, over: Record<string, unknown> = {}) => {
      const r = { status: 'published', author_role: null, stream_id: 's1', held_by: null, ...over };
      raw.prepare('INSERT INTO live_chat_messages (id, stream_id, user_id, author_name, author_role, text, status, held_by, is_pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 1, 1)').run(id, r.stream_id as string, 'u', 'U', r.author_role as null, 't', r.status as string, r.held_by as null);
    };
    put('m1');
    const db = { prepare: (sql: string) => ({ bind: (...args: never[]) => ({ run: async () => ({ meta: { changes: Number(raw.prepare(sql).run(...args).changes) } }) }) }) };
    const env = { SEARCH_DB: db, WEBSOCKET_URL: 'https://ws.example', INTERNAL_API_KEY: 'k' };
    const row = (id = 'm1') => ({ ...(raw.prepare('SELECT status, held_by, is_pinned, updated_at FROM live_chat_messages WHERE id = ?').get(id) as object) });
    return { raw, put, env, row };
  }

  it.each([['none', 'basic', false], ['basic', 'basic', true], ['strict', 'basic', true], ['none', 'strict', false], ['basic', 'strict', false], ['strict', 'strict', true]] as const)('setting %s, message %s: held %s', async (setting, level, held) => {
    const t = setup(setting);
    expect(await holdLiveChatMessage(t.env, 'm1', 's1', level, 500)).toBe(held);
    expect(t.row()).toEqual(held ? { status: 'held', held_by: 'moderation', is_pinned: 0, updated_at: 500 } : { status: 'published', held_by: null, is_pinned: 1, updated_at: 1 });
    expect(sent.map((s) => [s.channel, s.message.type, s.message.data.messageId])).toEqual(held ? [['live:s1', 'live_chat_removed', 'm1']] : []);
  });

  it('never the team’s, never one a person decided on, never another stream’s', async () => {
    const t = setup('strict');
    t.put('owner', { author_role: 'owner' });
    t.put('mod', { author_role: 'moderator' });
    t.put('removed', { status: 'removed' });
    t.put('blocked', { status: 'held', held_by: 'channel_block' });
    for (const id of ['owner', 'mod', 'removed', 'blocked', 'nope']) expect(await holdLiveChatMessage(t.env, id, 's1', 'basic')).toBe(false);
    expect(await holdLiveChatMessage(t.env, 'm1', 'other', 'basic')).toBe(false);
    expect(t.row('blocked')).toMatchObject({ held_by: 'channel_block' });
    expect(sent).toEqual([]);
    // A stream without a row holds nothing
    t.put('m2', { stream_id: 's2' });
    expect(await holdLiveChatMessage(t.env, 'm2', 's2', 'basic')).toBe(false);
  });

  it('seeks by primary key, and a database that is not bound holds nothing', async () => {
    const t = setup('basic');
    const plan = t.raw.prepare("EXPLAIN QUERY PLAN UPDATE live_chat_messages SET status = 'held' WHERE id = 'a' AND stream_id = 'b' AND status = 'published' AND author_role IS NULL AND EXISTS (SELECT 1 FROM live_stream_metadata m WHERE m.stream_id = 'b' AND m.ai_hold IN ('basic', 'strict'))").all();
    expect(JSON.stringify(plan)).not.toContain('SCAN');
    expect(await holdLiveChatMessage({}, 'm1', 's1', 'basic')).toBe(false);
  });
});
