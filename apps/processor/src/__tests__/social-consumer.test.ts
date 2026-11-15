/**
 * Social auto-post queue driver (AUN-SOCIAL, SOC-1): events go to api-videos for planning; delivery attempts
 * retry with backoff (or the network's own delay), give up on the last attempt or on a failure retrying can't fix,
 * and only then flag the admin with a Retry. The fan-out and new community posts announce events.
 */
import { MessageType, SOCIAL_LAST_ATTEMPT, socialRetryDelaySeconds } from '@al-ummah/shared-types';
import { isSocialMessage, processSocialMessages, socialEventMessage } from '../social/consumer';
import { MessageProcessor } from '../messageProcessor';

const logger = { debug: jest.fn(), info: jest.fn(), warn: jest.fn(), error: jest.fn(), job: jest.fn() } as never;

function msg(type: number, payload: unknown, attempts = 1) {
  return { body: { id: 'm1', type, payload }, attempts, ack: jest.fn(), retry: jest.fn() };
}

function videos(answers: Record<string, unknown>, status = 200) {
  const calls: Array<{ path: string; body: unknown }> = [];
  return {
    calls,
    fetch: jest.fn(async (url: string, init: RequestInit) => {
      const path = new URL(url).pathname.replace('/internal/social', '');
      calls.push({ path, body: JSON.parse(String(init.body)) });
      const key = Object.keys(answers).find((k) => path.endsWith(k));
      return new Response(JSON.stringify(key ? answers[key] : {}), { status: key ? status : 200 });
    }),
  };
}

function reporterFetch() {
  const posts: unknown[] = [];
  const f = jest.fn(async (_url: string, init: RequestInit) => {
    posts.push(JSON.parse(String(init.body)));
    return new Response('{}');
  });
  return { posts, f };
}

describe('social consumer', () => {
  let reporter: ReturnType<typeof reporterFetch>;
  beforeEach(() => {
    reporter = reporterFetch();
    (globalThis as { fetch: unknown }).fetch = reporter.f;
  });
  const base = { INTERNAL_API_KEY: 'k', ERRORS_INGEST_URL: 'https://admin.example/internal/errors' };

  it('recognises its message types', () => {
    expect(isSocialMessage({ body: { type: MessageType.SocialEvent } })).toBe(true);
    expect(isSocialMessage({ body: { type: MessageType.SocialDelivery } })).toBe(true);
    expect(isSocialMessage({ body: { type: MessageType.VideoView } })).toBe(false);
  });

  it('plans an event through api-videos with the internal key', async () => {
    const v = videos({ '/events': { posts: 2, webhooks: 1 } });
    const m = msg(MessageType.SocialEvent, { channelId: 'c1', event: 'video', entityId: 'v1' });
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(v.calls[0]).toEqual({ path: '/events', body: { channelId: 'c1', event: 'video', entityId: 'v1' } });
    expect((v.fetch.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'X-API-Key': 'k' });
    expect(m.ack).toHaveBeenCalled();
  });

  it('retries planning when api-videos fails', async () => {
    const v = videos({ '/events': {} }, 503);
    const m = msg(MessageType.SocialEvent, { channelId: 'c1', event: 'post', entityId: 'p1' }, 2);
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: socialRetryDelaySeconds(2) });
  });

  it('drops malformed messages', async () => {
    const m1 = msg(MessageType.SocialEvent, { channelId: 'c1', event: 'tweet', entityId: 'x' });
    const m2 = msg(MessageType.SocialDelivery, { kind: 'post', deliveryId: '../../etc' });
    await processSocialMessages([m1, m2], { ...base, VIDEOS: videos({}) } as never, undefined, logger);
    expect(m1.ack).toHaveBeenCalled();
    expect(m2.ack).toHaveBeenCalled();
  });

  it('acks a sent delivery and resolves its admin item', async () => {
    const v = videos({ '/attempt': { outcome: 'sent' } });
    const m = msg(MessageType.SocialDelivery, { kind: 'post', deliveryId: 'sd_1' });
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(m.ack).toHaveBeenCalled();
    expect(reporter.posts).toEqual([{ resolved: [{ key: 'social-post:sd_1' }] }]);
  });

  it("waits the network's Retry-After when it is longer than the backoff", async () => {
    const v = videos({ '/attempt': { outcome: 'retry', retryAfterSeconds: 900, error: 'X post: HTTP 429' } });
    const m = msg(MessageType.SocialDelivery, { kind: 'post', deliveryId: 'sd_1' }, 1);
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(m.retry).toHaveBeenCalledWith({ delaySeconds: 900 });
    expect(reporter.posts).toEqual([]);
  });

  it('gives up on the last attempt: records it and flags the admin with a Retry', async () => {
    const v = videos({ '/attempt': { outcome: 'retry', error: 'Mastodon post: HTTP 503' }, '/give-up': { channelId: 'c1', network: 'mastodon', entityId: 'v1', event: 'video', error: 'Mastodon post: HTTP 503' } });
    const m = msg(MessageType.SocialDelivery, { kind: 'post', deliveryId: 'sd_9' }, SOCIAL_LAST_ATTEMPT);
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(m.ack).toHaveBeenCalled();
    expect(v.calls.map((c) => c.path)).toEqual(['/deliveries/sd_9/attempt', '/deliveries/sd_9/give-up']);
    const event = (reporter.posts[0] as { events: Array<{ action: Record<string, unknown> }> }).events[0];
    expect(event.action).toMatchObject({
      key: 'social-post:sd_9',
      title: 'Social post to mastodon failed',
      retry: { kind: 'service', service: 'api-videos', path: '/internal/social/deliveries/retry', body: { kind: 'post', deliveryId: 'sd_9' } },
    });
  });

  it('gives up at once on a failure retrying cannot fix', async () => {
    const v = videos({ '/attempt': { outcome: 'failed', error: 'video_too_long' }, '/give-up': { channelId: 'c1', entityId: 'v1' } });
    const m = msg(MessageType.SocialDelivery, { kind: 'webhook', deliveryId: 'wd_1' }, 1);
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(m.retry).not.toHaveBeenCalled();
    expect((reporter.posts[0] as { events: Array<{ action: { title: string } }> }).events[0].action.title).toBe('Channel webhook delivery failed');
  });

  it('flags the spent X budget once a month, not per post', async () => {
    const v = videos({ '/attempt': { outcome: 'blocked', error: 'x_budget_reached', flagAdmin: true } });
    const m = msg(MessageType.SocialDelivery, { kind: 'post', deliveryId: 'sd_2' });
    await processSocialMessages([m], { ...base, VIDEOS: v } as never, undefined, logger);
    expect(m.ack).toHaveBeenCalled();
    const action = (reporter.posts[0] as { events: Array<{ action: { key: string } }> }).events[0].action;
    expect(action.key).toMatch(/^social-x-cap:\d{4}-\d{2}$/);
  });

  it('treats an unreachable api-videos as retryable', async () => {
    const m = msg(MessageType.SocialDelivery, { kind: 'post', deliveryId: 'sd_3' }, 1);
    await processSocialMessages([m], { ...base } as never, undefined, logger);
    expect(m.retry).toHaveBeenCalled();
  });
});

describe('events announced to social', () => {
  function queueEnv() {
    const sent: Array<{ type: number; payload: unknown }> = [];
    return { sent, env: { MESSAGE_QUEUE: { send: jest.fn(async (m: { type: number; payload: unknown }) => void sent.push(m)) } } };
  }

  it('builds a stable event message', () => {
    expect(socialEventMessage({ channelId: 'c1', event: 'short', entityId: 'v2' })).toMatchObject({ id: 'social:short:v2', type: MessageType.SocialEvent });
  });

  it('a new community post becomes a post event', async () => {
    const { sent, env } = queueEnv();
    const p = new MessageProcessor(logger);
    await (p as unknown as { processCommunityPostMessage(m: unknown, e: unknown): Promise<void> }).processCommunityPostMessage(
      { id: 'x', type: MessageType.CommunityPostCreated, timestamp: 1, payload: { postId: 'p1', channelId: 'c1' } },
      env,
    );
    expect(sent).toEqual([expect.objectContaining({ type: MessageType.SocialEvent, payload: { channelId: 'c1', event: 'post', entityId: 'p1' } })]);
  });
});
