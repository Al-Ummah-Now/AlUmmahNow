/**
 * Invite creators (docs/admin/INVITES.md): /api/invites through the real
 * router over SQLite (migrations applied), a fake api-videos and a fake auth
 * behind the queue. Who may do what, the existing-account check, the user id
 * minted here and used everywhere, channels made or moved before sign-in, the
 * queue to auth, and revoke/restore/purge.
 */
import { beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import invitesRouter from '../src/routers/invites.router';
import contentRouter from '../src/routers/content.router';
import { handleAuthRequestBatch } from '../src/lib/authModerationQueue';
import { AuthInviteClient, INVITE_ACTIONS_PER_HOUR, scheduleInviteSyncs, sha256Hex, signInUrl, type InviteMessage } from '../src/lib/invites';
import { sqliteD1 } from './d1-sqlite';

interface Call { method: string; path: string; body: any }

/** api-videos: an Auth user list and profile store, enough for invites. */
function fakeVideos(state: { authUsers: Array<{ id: string; email: string; name: string | null; status: string }>; profiles: Map<string, any>; channels: Map<string, any>; failChannel?: string }) {
  const calls: Call[] = [];
  const reply = (body: unknown, status = 200) => new Response(JSON.stringify(status < 300 ? { success: true, result: body } : body), { status, headers: { 'content-type': 'application/json' } });
  return {
    calls,
    fetcher: {
      async fetch(input: string, init: RequestInit = {}) {
        const url = new URL(input);
        const path = url.pathname.replace('/internal/admin', '');
        const method = init.method ?? 'GET';
        const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
        calls.push({ method, path, body });
        if (method === 'GET' && path === '/accounts') {
          const email = url.searchParams.get('email');
          const profile = [...state.profiles.values()].find((p) => p.email === email);
          return reply({ authUser: state.authUsers.find((u) => u.email === email) ?? null, profile: profile ? { id: profile.id, displayName: profile.displayName ?? null } : null });
        }
        if (method === 'GET' && path === '/creator-tiers') return reply({ items: [{ id: 'creator' }, { id: 'unlimited' }] });
        if (method === 'POST' && path === '/users/provision') {
          state.profiles.set(body.userId, { id: body.userId, email: body.email, displayName: body.displayName });
          return reply({ profile: state.profiles.get(body.userId), created: true });
        }
        const tier = /^\/users\/([^/]+)\/creator-tier$/.exec(path);
        if (tier && method === 'PUT') {
          state.profiles.get(tier[1]).tier = body.tierId;
          return reply({ assignment: { tierId: body.tierId } });
        }
        const create = /^\/users\/([^/]+)\/channels$/.exec(path);
        if (create && method === 'POST') {
          if (body.name === state.failChannel) return reply({ success: false, code: 'handle_taken', error: 'This handle is taken' }, 409);
          const id = `ch_${state.channels.size + 1}`;
          state.channels.set(id, { id, name: body.name, handle: body.handle ?? id, ownerId: create[1] });
          return reply({ channel: state.channels.get(id) });
        }
        const channel = /^\/channels\/([^/]+)$/.exec(path);
        if (channel && method === 'GET') return reply(state.channels.get(channel[1]));
        const transfer = /^\/channels\/([^/]+)\/transfer$/.exec(path);
        if (transfer && method === 'POST') {
          state.channels.get(transfer[1]).ownerId = body.newOwnerId;
          return reply({ job: { id: `job_${transfer[1]}` } });
        }
        if (method === 'GET' && path === '/users') return reply({ items: [...state.profiles.values()].map((p) => ({ id: p.id })), total: state.profiles.size, page: 1, pageSize: 20 });
        return reply({ ok: true });
      },
    },
  };
}

/** Auth's /provisioning/invites as the queue consumer sees it. */
function fakeAuth() {
  const invites = new Map<string, any>();
  const calls: Call[] = [];
  let failNext: { status: number; error: string } | null = null;
  const fetchImpl = (async (input: string, init: RequestInit = {}) => {
    const url = new URL(input);
    const method = init.method ?? 'GET';
    const body = typeof init.body === 'string' ? JSON.parse(init.body) : null;
    calls.push({ method, path: url.pathname, body });
    const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });
    if (failNext) {
      const f = failNext;
      failNext = null;
      return json({ error: f.error, error_description: f.error }, f.status);
    }
    if (method === 'POST' && url.pathname === '/provisioning/invites') {
      const invite = { id: body.inviteId, userId: body.userId, status: 'invited', expiresAt: Date.now() + body.expiresInDays * 86400_000, acceptedAt: null, lastSentAt: Date.now(), sendCount: 1, deletedAt: null, purgeRequestedAt: null };
      invites.set(invite.id, invite);
      return json({ invite, emailSent: true }, 201);
    }
    if (method === 'GET') return json({ invites: (url.searchParams.get('ids') ?? '').split(',').map((id) => invites.get(id)).filter(Boolean) });
    const op = /^\/provisioning\/invites\/([^/]+)\/(\w+)$/.exec(url.pathname);
    if (op) {
      const invite = invites.get(op[1]);
      if (op[2] === 'revoke') Object.assign(invite, { status: 'revoked', deletedAt: Date.now() });
      if (op[2] === 'restore') Object.assign(invite, { status: 'invited', deletedAt: null });
      if (op[2] === 'resend') invite.sendCount++;
      return json({ invite, emailSent: op[2] === 'resend' });
    }
    return json({ error: 'not_found' }, 404);
  }) as typeof fetch;
  return { invites, calls, fetchImpl, fail: (status: number, error: string) => void (failNext = { status, error }) };
}

class FakeQueue {
  messages: InviteMessage[] = [];
  async send(body: InviteMessage) {
    this.messages.push(body);
  }
  async sendBatch(batch: Array<{ body: InviteMessage }>) {
    for (const b of batch) this.messages.push(b.body);
  }
}

function setup(opts: { authUsers?: Array<{ id: string; email: string; name: string | null; status: string }>; failChannel?: string } = {}) {
  const db = sqliteD1();
  const state = { authUsers: opts.authUsers ?? [], profiles: new Map<string, any>(), channels: new Map<string, any>([['ch_old', { id: 'ch_old', name: 'Old', handle: 'old', ownerId: 'usr_someone' }]]), failChannel: opts.failChannel };
  const videos = fakeVideos(state);
  const auth = fakeAuth();
  const queue = new FakeQueue();
  const env = {
    REPORTS_DB: db,
    VIDEOS: videos.fetcher,
    INTERNAL_API_KEY: 'k',
    AUTH_REQUESTS_QUEUE: queue,
    Issuer: 'https://auth.qa.alummahnow.net',
    AUTH_MODERATION_CLIENT_ID: 'client',
    AUTH_MODERATION_CLIENT_SECRET: 'secret',
    ADMIN_WEB_URL: 'https://admin.qa.alummahnow.net',
  };
  const app = new Hono();
  app.use('*', async (c, next) => {
    const roles = c.req.header('x-test-roles') ?? 'super_admin';
    c.set('auth' as never, { userId: c.req.header('x-test-user') ?? 'usr_admin', email: 'admin@example.com', roles: roles ? roles.split(',') : [] } as never);
    await next();
  });
  app.route('/api/invites', invitesRouter);
  app.route('/api/content', contentRouter);
  const call = async (method: string, path: string, json?: unknown, roles?: string) => {
    const res = await app.request(path, { method, headers: { 'content-type': 'application/json', ...(roles !== undefined ? { 'x-test-roles': roles } : {}) }, ...(json !== undefined ? { body: JSON.stringify(json) } : {}) }, env);
    return { status: res.status, body: (await res.json()) as any };
  };
  /** Runs the queued messages through the consumer, as Cloudflare would. */
  const drain = async () => {
    const client = AuthInviteClient.fromEnv(env as never, auth.fetchImpl);
    while (queue.messages.length) {
      const body = queue.messages.shift()!;
      let retried = false;
      await handleAuthRequestBatch(
        { queue: 'auth-moderation-requests-qa', messages: [{ body, attempts: 1, ack() {}, retry() { retried = true; } }] } as never,
        env as never,
        undefined,
        client
      );
      if (retried) queue.messages.push(body);
    }
  };
  return { db, env, state, videos, auth, queue, call, drain };
}

const invite = (overrides: Record<string, unknown> = {}) => ({ email: '  New.Creator@Example.com ', name: 'New Creator', role: 'creator', tierId: 'creator', locale: 'ar', note: 'Welcome', ...overrides });

describe('POST /api/invites', () => {
  it('makes the user at once with a stable id: profile, plan and a new channel, then auth through the queue', async () => {
    const t = setup();
    const res = await t.call('POST', '/api/invites', invite({ channels: { create: [{ name: 'Tafsir Daily', handle: 'tafsir-daily' }] } }));
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const inv = res.body.result.invite;
    assert.match(inv.id, /^inv_[0-9a-f]{32}$/);
    assert.match(inv.userId, /^usr_[0-9a-f]{32}$/);
    assert.equal(inv.email, 'new.creator@example.com');
    assert.equal(inv.status, 'sending');
    // The same id everywhere: profile, plan, channel owner
    const profile = t.state.profiles.get(inv.userId);
    assert.equal(profile.email, 'new.creator@example.com');
    assert.equal(profile.tier, 'creator');
    assert.deepEqual(inv.channels.map((c: any) => [c.name, c.action]), [['Tafsir Daily', 'created']]);
    assert.equal(t.state.channels.get(inv.channels[0].id).ownerId, inv.userId);

    await t.drain();
    const created = t.auth.calls.find((c) => c.path === '/provisioning/invites')!;
    assert.equal(created.body.userId, inv.userId);
    assert.equal(created.body.inviteId, inv.id);
    assert.equal(created.body.locale, 'ar');
    assert.equal(created.body.continueUrl, 'https://videos.qa.alummahnow.net/api/auth/login?prompt=login&locale=ar&return=%2Far');
    const after = await t.call('GET', `/api/invites/${inv.id}`);
    assert.equal(after.body.result.status, 'invited');
    assert.equal(after.body.result.emailSent, true);
  });

  it('assigns existing channels (transfer job) to the invited user before sign-in', async () => {
    const t = setup();
    const res = await t.call('POST', '/api/invites', invite({ channels: { transfer: ['ch_old'] } }));
    const inv = res.body.result.invite;
    assert.equal(t.state.channels.get('ch_old').ownerId, inv.userId);
    assert.deepEqual(inv.channels, [{ id: 'ch_old', name: 'Old', handle: 'old', action: 'transferred', jobId: 'job_ch_old' }]);
  });

  it('offers the existing account instead when the email already has one (any case)', async () => {
    const t = setup({ authUsers: [{ id: 'usr_member', email: 'member@example.com', name: 'M', status: 'active' }] });
    const res = await t.call('POST', '/api/invites', invite({ email: 'MEMBER@example.com ' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'user_exists');
    assert.equal(res.body.user.id, 'usr_member');
    assert.equal(t.state.profiles.size, 0, 'nothing was made');
    const lookup = await t.call('GET', '/api/invites/lookup?email=member%40example.com');
    assert.equal(lookup.body.result.authUser.id, 'usr_member');
  });

  it('never two invites for one email', async () => {
    const t = setup();
    await t.call('POST', '/api/invites', invite());
    const res = await t.call('POST', '/api/invites', invite({ email: 'new.creator@example.com' }));
    assert.equal(res.status, 409);
    assert.equal(res.body.code, 'already_invited');
  });

  it('a channel that cannot be made is a warning; the invite still stands', async () => {
    const t = setup({ failChannel: 'Taken' });
    const res = await t.call('POST', '/api/invites', invite({ channels: { create: [{ name: 'Taken', handle: 'x' }, { name: 'Fine' }] } }));
    assert.equal(res.status, 201);
    assert.deepEqual(res.body.result.warnings.map((w: any) => w.code), ['handle_taken']);
    assert.deepEqual(res.body.result.invite.channels.map((c: any) => c.name), ['Fine']);
  });

  it('checks permissions: moderators read only, admins cannot move channels, plans must exist', async () => {
    const t = setup();
    assert.equal((await t.call('POST', '/api/invites', invite(), 'moderator')).status, 403);
    assert.equal((await t.call('GET', '/api/invites', undefined, 'moderator')).status, 200);
    const admin = await t.call('POST', '/api/invites', invite({ channels: { transfer: ['ch_old'] } }), 'admin');
    assert.equal(admin.status, 403);
    assert.match(admin.body.error, /channels:transfer/);
    assert.equal((await t.call('POST', '/api/invites', invite({ tierId: 'gold' }))).body.code, 'unknown_plan');
    assert.equal((await t.call('POST', '/api/invites', invite({ email: 'nope' }))).body.code, 'invalid_email');
    assert.equal((await t.call('POST', '/api/invites', invite({ expiresInDays: 120 }))).status, 400);
  });

  it('is rate limited per admin', async () => {
    const t = setup();
    for (let i = 0; i < INVITE_ACTIONS_PER_HOUR; i++) {
      await t.db.prepare("INSERT INTO admin_audit_log (id, actor_id, action, target_type, target_id, created_at) VALUES (?, 'usr_admin', 'invite.created', 'user', 'u', ?)").bind(`a${i}`, new Date().toISOString()).run();
    }
    const res = await t.call('POST', '/api/invites', invite());
    assert.equal(res.status, 429);
  });
});

describe('the queue to auth', () => {
  it('a permanent refusal flags the invite (Retry), a later retry delivers it', async () => {
    const t = setup();
    const inv = (await t.call('POST', '/api/invites', invite())).body.result.invite;
    t.auth.fail(409, 'user_exists');
    await t.drain();
    const failed = await t.call('GET', `/api/invites/${inv.id}`);
    assert.equal(failed.body.result.status, 'failed');
    assert.match(failed.body.result.deliveryError, /user_exists/);
    assert.equal((await t.call('GET', '/api/invites?status=failed')).body.result.items.length, 1);
    await t.call('POST', `/api/invites/${inv.id}/retry`);
    await t.drain();
    assert.equal((await t.call('GET', `/api/invites/${inv.id}`)).body.result.status, 'invited');
  });

  it('the cron reads open invites and sees the first sign-in', async () => {
    const t = setup();
    const inv = (await t.call('POST', '/api/invites', invite())).body.result.invite;
    await t.drain();
    Object.assign(t.auth.invites.get(inv.id), { status: 'active', acceptedAt: Date.now() });
    assert.equal(await scheduleInviteSyncs(t.env as never), 1);
    await t.drain();
    const now = await t.call('GET', `/api/invites/${inv.id}`);
    assert.equal(now.body.result.status, 'active');
    assert.equal(await scheduleInviteSyncs(t.env as never, Date.now() + 120_000), 0, 'accepted invites are not read again');
  });

  it('user lists carry the invite status (the Invited badge)', async () => {
    const t = setup();
    const inv = (await t.call('POST', '/api/invites', invite())).body.result.invite;
    await t.drain();
    const users = await t.call('GET', '/api/content/users');
    assert.deepEqual(users.body.result.items.find((u: any) => u.id === inv.userId).invite, { id: inv.id, status: 'invited' });
  });
});

describe('resend, copy link, revoke, restore, purge', () => {
  it('resend and copy link go to auth; the link is shown once and only its hash is sent', async () => {
    const t = setup();
    const inv = (await t.call('POST', '/api/invites', invite())).body.result.invite;
    await t.drain();
    await t.call('POST', `/api/invites/${inv.id}/resend`);
    const link = await t.call('POST', `/api/invites/${inv.id}/link`);
    const url = link.body.result.url as string;
    assert.match(url, /^https:\/\/auth\.qa\.alummahnow\.net\/invite\/[0-9a-f]{64}\?lang=ar$/);
    await t.drain();
    const sent = t.auth.calls.find((c) => c.path.endsWith('/link'))!;
    const token = /invite\/([0-9a-f]{64})/.exec(url)![1];
    assert.equal(sent.body.tokenHash, await sha256Hex(token));
    assert.ok(!JSON.stringify(t.auth.calls).includes(token), 'the token itself never leaves');
    const row = await t.db.prepare('SELECT * FROM creator_invites WHERE id = ?').bind(inv.id).first<Record<string, unknown>>();
    assert.ok(!JSON.stringify(row).includes(token), 'nor is it stored');
    assert.equal(t.auth.invites.get(inv.id).sendCount, 2);
  });

  it('revoke is a soft delete with 30 days to restore; purge needs the email and only queues it', async () => {
    const t = setup();
    const inv = (await t.call('POST', '/api/invites', invite())).body.result.invite;
    await t.drain();
    const revoked = await t.call('POST', `/api/invites/${inv.id}/revoke`, { reason: 'Wrong person' });
    assert.equal(revoked.body.result.status, 'revoked');
    assert.equal(revoked.body.result.deletedReason, 'Wrong person');
    assert.equal(Date.parse(revoked.body.result.purgeAfter) - Date.parse(revoked.body.result.deletedAt), 30 * 86400_000);
    await t.drain();
    assert.equal(t.auth.invites.get(inv.id).status, 'revoked');
    assert.equal((await t.call('POST', `/api/invites/${inv.id}/resend`)).body.code, 'revoked');

    assert.equal((await t.call('POST', `/api/invites/${inv.id}/purge`, { confirm: 'x@example.com' })).body.code, 'confirm_mismatch');
    const restored = await t.call('POST', `/api/invites/${inv.id}/restore`);
    assert.equal(restored.body.result.deletedAt, null);
    await t.drain();
    assert.equal(t.auth.invites.get(inv.id).status, 'invited');

    await t.call('POST', `/api/invites/${inv.id}/revoke`, {});
    const purge = await t.call('POST', `/api/invites/${inv.id}/purge`, { confirm: 'NEW.CREATOR@example.com' });
    assert.ok(purge.body.result.purgeRequestedAt);
    assert.equal(purge.body.result.purgeAfter, purge.body.result.purgeRequestedAt);
    await t.drain();
    assert.ok(t.auth.calls.some((c) => c.path.endsWith('/purge')));
  });

  it('revoked before auth had it: auth never makes the account; restore makes it then', async () => {
    const t = setup();
    const inv = (await t.call('POST', '/api/invites', invite())).body.result.invite;
    await t.call('POST', `/api/invites/${inv.id}/revoke`, {});
    await t.drain();
    assert.equal(t.auth.invites.size, 0);
    await t.call('POST', `/api/invites/${inv.id}/restore`);
    await t.drain();
    assert.equal(t.auth.invites.size, 1);
  });
});

describe('signInUrl', () => {
  it('derives the videos web sign-in from the admin host, or takes VIDEOS_WEB_URL', () => {
    assert.equal(signInUrl({ ADMIN_WEB_URL: 'https://admin.alummahnow.net' }, 'en'), 'https://videos.alummahnow.net/api/auth/login?prompt=login&locale=en&return=%2Fen');
    assert.equal(signInUrl({ VIDEOS_WEB_URL: 'http://localhost:3001' }, 'en'), 'http://localhost:3001/api/auth/login?prompt=login&locale=en&return=%2Fen');
    assert.equal(signInUrl({}, 'en'), null);
  });
});
