/**
 * Fake social networks for the local stack (wiki AUN-SOCIAL, SOC-1): what api-videos' adapters call, answered
 * here, so Studio → Social connects and posts end to end without a real account, token or paid API call.
 *
 * - Mastodon: any `*.mastodon.local-stack.test` instance (apps, OAuth authorize → auto-approve, token,
 *   verify_credentials, instance, media, statuses, revoke).
 * - X: x.com/i/oauth2/authorize (auto-approve) and api.x.com (token, users/me, tweets, media upload, revoke).
 * - Telegram: api.telegram.org/bot<token>/<method> (getMe, setWebhook, getChatMember, deleteMessage,
 *   sendMessage, sendVideo). A spec "posts the code in its channel" with POST /__fake/social/telegram/post,
 *   which delivers the update to the webhook api-videos registered, with its secret.
 * - Bluesky: public.api.bsky.app (resolveHandle), plc.directory, a PDS and an authorization server at
 *   bsky.local-stack.test (protected resource, server metadata, PAR, authorize → auto-approve, token, revoke,
 *   uploadBlob, createRecord). The first PAR answers use_dpop_nonce, as Bluesky does.
 * - Webhook receiver: hooks.local-stack.test keeps every signed POST (api-videos lets this host through with
 *   SOCIAL_WEBHOOK_ALLOW_HOSTS).
 *
 * Control (loopback, via fake-external.ts): GET /__fake/social/posts[?network=], GET /__fake/social/webhooks,
 * POST /__fake/social/telegram/post, POST /__fake/social/fail?network=<n>&status=<code>[&count=<n>].
 */
import type { FakeHandler } from './outbound.ts';

export const FAKE_MASTODON_DOMAIN = 'mastodon.local-stack.test';
export const FAKE_BSKY_HOST = 'bsky.local-stack.test';
export const FAKE_HOOKS_HOST = 'hooks.local-stack.test';
const BOT_ID = 7_000_001;
const BOT_USERNAME = 'aun_local_bot';

export interface FakePost {
  network: 'x' | 'telegram' | 'bluesky' | 'mastodon';
  id: string;
  account: string;
  text: string;
  media: boolean;
  link?: string;
  at: string;
}
export interface FakeHookCall {
  path: string;
  headers: Record<string, string>;
  body: string;
  at: string;
}

export const social = {
  posts: [] as FakePost[],
  hooks: [] as FakeHookCall[],
  /** network → status codes to answer the next post attempts with */
  failures: new Map<string, number[]>(),
  telegram: { webhookUrl: '', secret: '' },
  nonceServed: false,
  /** bluesky handle → did */
  dids: new Map<string, string>(),
};

const json = (body: unknown, status = 200, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const id = () => crypto.randomUUID().replace(/-/g, '').slice(0, 16);
const now = () => new Date().toISOString();

/** The next injected failure for a network's post, if any. */
function injected(network: string): Response | null {
  const list = social.failures.get(network);
  const status = list?.shift();
  if (status === undefined) return null;
  if (!list!.length) social.failures.delete(network);
  return json({ error: 'injected by the local stack', description: 'injected' }, status, status === 429 ? { 'retry-after': '1' } : {});
}

async function form(request: Request): Promise<URLSearchParams> {
  return new URLSearchParams(await request.text());
}

/** OAuth authorize pages approve at once: back to the redirect with a code and the state. */
function approve(url: URL, extra: Record<string, string> = {}): Response {
  const redirect = url.searchParams.get('redirect_uri');
  if (!redirect) return new Response('redirect_uri missing', { status: 400 });
  const back = new URL(redirect);
  back.searchParams.set('code', `code-${id()}`);
  const state = url.searchParams.get('state');
  if (state) back.searchParams.set('state', state);
  for (const [k, v] of Object.entries(extra)) back.searchParams.set(k, v);
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}

// ---------------------------------------------------------------------------------------------- Mastodon
const mastodon: FakeHandler = async (request, url) => {
  const instance = url.hostname;
  const p = url.pathname;
  if (request.method === 'POST' && p === '/api/v1/apps') return json({ client_id: `client-${id()}`, client_secret: `secret-${id()}`, name: 'Al Ummah Now' });
  if (request.method === 'GET' && p === '/oauth/authorize') return approve(url);
  if (request.method === 'POST' && p === '/oauth/token') return json({ access_token: `mtok-${id()}`, token_type: 'Bearer', scope: 'write:statuses write:media read:accounts', created_at: Math.floor(Date.now() / 1000) });
  if (request.method === 'POST' && p === '/oauth/revoke') return json({});
  if (request.method === 'GET' && p === '/api/v1/accounts/verify_credentials') {
    const user = instance.split('.')[0] || 'creator';
    return json({ id: '109000001', username: user, acct: user, display_name: `Local ${user}`, url: `https://${instance}/@${user}` });
  }
  if (request.method === 'GET' && p === '/api/v2/instance') return json({ domain: instance, configuration: { statuses: { max_characters: 500 }, media_attachments: { video_size_limit: 99_000_000 } } });
  if (request.method === 'POST' && p === '/api/v2/media') return json({ id: `m-${id()}`, type: 'video', url: null }, 202);
  if (request.method === 'GET' && p.startsWith('/api/v1/media/')) return json({ id: p.split('/').pop(), type: 'video', url: `https://${instance}/media/x.mp4` });
  if (request.method === 'POST' && p === '/api/v1/statuses') {
    const fail = injected('mastodon');
    if (fail) return fail;
    const body = (await request.json().catch(() => ({}))) as { status?: string; media_ids?: string[] };
    const sid = String(Date.now());
    social.posts.push({ network: 'mastodon', id: sid, account: instance, text: body.status ?? '', media: !!body.media_ids?.length, at: now() });
    return json({ id: sid, url: `https://${instance}/@creator/${sid}` });
  }
  return json({ error: 'not faked' }, 404);
};

// ---------------------------------------------------------------------------------------------- X
const xWeb: FakeHandler = (_request, url) => (url.pathname === '/i/oauth2/authorize' ? approve(url) : new Response('not faked', { status: 404 }));

const xApi: FakeHandler = async (request, url) => {
  const p = url.pathname;
  if (request.method === 'POST' && p === '/2/oauth2/token') {
    const f = await form(request);
    if (!request.headers.get('authorization')?.startsWith('Basic ')) return json({ error: 'unauthorized_client' }, 401);
    if (!['authorization_code', 'refresh_token'].includes(f.get('grant_type') ?? '')) return json({ error: 'invalid_request' }, 400);
    return json({ token_type: 'bearer', access_token: `xtok-${id()}`, refresh_token: `xref-${id()}`, expires_in: 7200, scope: 'tweet.read tweet.write users.read offline.access media.write' });
  }
  if (request.method === 'POST' && p === '/2/oauth2/revoke') return json({ revoked: true });
  if (request.method === 'GET' && p === '/2/users/me') return json({ data: { id: '1500000000000000001', username: 'aun_local', name: 'Local creator' } });
  if (request.method === 'POST' && p === '/2/media/upload/initialize') return json({ data: { id: `xm-${id()}` } });
  if (request.method === 'POST' && /^\/2\/media\/upload\/[^/]+\/append$/.test(p)) return new Response(null, { status: 204 });
  if (request.method === 'POST' && /^\/2\/media\/upload\/[^/]+\/finalize$/.test(p)) return json({ data: { processing_info: { state: 'succeeded' } } });
  if (request.method === 'GET' && p === '/2/media/upload') return json({ data: { processing_info: { state: 'succeeded' } } });
  if (request.method === 'POST' && p === '/2/tweets') {
    const fail = injected('x');
    if (fail) return fail;
    const body = (await request.json().catch(() => ({}))) as { text?: string; media?: { media_ids?: string[] } };
    const tid = String(1_800_000_000_000_000_000n + BigInt(social.posts.length));
    social.posts.push({ network: 'x', id: tid, account: 'aun_local', text: body.text ?? '', media: !!body.media?.media_ids?.length, at: now() });
    return json({ data: { id: tid, text: body.text } }, 201);
  }
  return json({ error: 'not faked' }, 404);
};

// ---------------------------------------------------------------------------------------------- Telegram
const telegram: FakeHandler = async (request, url) => {
  const match = /^\/bot([^/]+)\/([A-Za-z]+)$/.exec(url.pathname);
  if (!match || request.method !== 'POST') return json({ ok: false, error_code: 404, description: 'Not Found' }, 404);
  const method = match[2];
  const isForm = (request.headers.get('content-type') ?? '').startsWith('multipart/');
  const body: Record<string, unknown> = isForm ? Object.fromEntries([...(await request.formData()).entries()].map(([k, v]) => [k, typeof v === 'string' ? v : '[file]'])) : ((await request.json().catch(() => ({}))) as Record<string, unknown>);
  switch (method) {
    case 'getMe':
      return json({ ok: true, result: { id: BOT_ID, is_bot: true, first_name: 'Al Ummah Now', username: BOT_USERNAME } });
    case 'setWebhook':
      social.telegram = { webhookUrl: String(body.url ?? ''), secret: String(body.secret_token ?? '') };
      return json({ ok: true, result: true });
    case 'deleteWebhook':
      social.telegram = { webhookUrl: '', secret: '' };
      return json({ ok: true, result: true });
    case 'getChatMember':
      return json({ ok: true, result: { status: 'administrator', can_post_messages: true, user: { id: BOT_ID } } });
    case 'deleteMessage':
      return json({ ok: true, result: true });
    case 'sendMessage':
    case 'sendVideo': {
      const fail = injected('telegram');
      if (fail) return json({ ok: false, error_code: fail.status, description: 'Forbidden: injected' }, fail.status);
      const messageId = social.posts.length + 100;
      social.posts.push({ network: 'telegram', id: String(messageId), account: String(body.chat_id ?? ''), text: String(body.text ?? body.caption ?? ''), media: method === 'sendVideo', at: now() });
      return json({ ok: true, result: { message_id: messageId, chat: { id: Number(body.chat_id), type: 'channel' } } });
    }
    default:
      return json({ ok: false, error_code: 400, description: `Bad Request: ${method} not faked` }, 400);
  }
};

/** A spec "posts the code in its Telegram channel": the update goes to api-videos' webhook. */
export async function telegramChannelPost(input: { text: string; chatId?: number; title?: string; username?: string }): Promise<Response> {
  if (!social.telegram.webhookUrl) return json({ error: 'no webhook registered: save the bot token in the admin first' }, 409);
  const chat = { id: input.chatId ?? -1_000_000_000_001, type: 'channel', title: input.title ?? 'Local channel', ...(input.username ? { username: input.username } : {}) };
  const update = { update_id: Date.now(), channel_post: { message_id: Date.now() % 100_000, chat, text: input.text, date: Math.floor(Date.now() / 1000) } };
  const res = await fetch(social.telegram.webhookUrl.replace('://localhost', '://127.0.0.1'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'X-Telegram-Bot-Api-Secret-Token': social.telegram.secret },
    body: JSON.stringify(update),
  });
  return json({ delivered: res.status, chat }, res.ok ? 200 : 502);
}

// ---------------------------------------------------------------------------------------------- Bluesky
const BSKY_ORIGIN = `https://${FAKE_BSKY_HOST}`;

function didFor(handle: string): string {
  let did = social.dids.get(handle);
  if (!did) {
    did = `did:plc:local${id()}`;
    social.dids.set(handle, did);
  }
  return did;
}
const handleOf = (did: string) => [...social.dids.entries()].find(([, d]) => d === did)?.[0];

const bskyResolver: FakeHandler = (_request, url) => {
  if (url.pathname !== '/xrpc/com.atproto.identity.resolveHandle') return json({ error: 'NotFound' }, 404);
  const handle = url.searchParams.get('handle') ?? '';
  if (!handle.endsWith('.bsky.local-stack.test')) return json({ error: 'InvalidRequest', message: 'Unable to resolve handle' }, 400);
  return json({ did: didFor(handle) });
};

const plc: FakeHandler = (_request, url) => {
  const did = decodeURIComponent(url.pathname.slice(1));
  const handle = handleOf(did);
  if (!handle) return json({ message: 'DID not registered' }, 404);
  return json({ id: did, alsoKnownAs: [`at://${handle}`], service: [{ id: '#atproto_pds', type: 'AtprotoPersonalDataServer', serviceEndpoint: BSKY_ORIGIN }] });
};

/** codes → did, so the token answer names the account that approved */
const bskyCodes = new Map<string, string>();
const bskyRequests = new Map<string, string>();

const bsky: FakeHandler = async (request, url) => {
  const p = url.pathname;
  if (p === '/.well-known/oauth-protected-resource') return json({ resource: BSKY_ORIGIN, authorization_servers: [BSKY_ORIGIN] });
  if (p === '/.well-known/oauth-authorization-server') {
    return json({
      issuer: BSKY_ORIGIN,
      pushed_authorization_request_endpoint: `${BSKY_ORIGIN}/oauth/par`,
      authorization_endpoint: `${BSKY_ORIGIN}/oauth/authorize`,
      token_endpoint: `${BSKY_ORIGIN}/oauth/token`,
      revocation_endpoint: `${BSKY_ORIGIN}/oauth/revoke`,
      dpop_signing_alg_values_supported: ['ES256'],
    });
  }
  if (request.method === 'POST' && p === '/oauth/par') {
    if (!request.headers.get('dpop')) return json({ error: 'invalid_dpop_proof' }, 400);
    // Like Bluesky: the first proof without a nonce is answered with one
    if (!social.nonceServed) {
      social.nonceServed = true;
      return json({ error: 'use_dpop_nonce' }, 400, { 'dpop-nonce': `n-${id()}` });
    }
    const f = await form(request);
    if (f.get('client_assertion_type') !== 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer' || !f.get('code_challenge')) return json({ error: 'invalid_request' }, 400);
    const requestUri = `urn:ietf:params:oauth:request_uri:${id()}`;
    bskyRequests.set(requestUri, JSON.stringify({ redirect: f.get('redirect_uri'), state: f.get('state'), handle: f.get('login_hint') }));
    return json({ request_uri: requestUri, expires_in: 300 }, 201);
  }
  if (request.method === 'GET' && p === '/oauth/authorize') {
    const saved = bskyRequests.get(url.searchParams.get('request_uri') ?? '');
    if (!saved) return new Response('unknown request_uri', { status: 400 });
    const { redirect, state, handle } = JSON.parse(saved) as { redirect: string; state: string; handle: string };
    const code = `bcode-${id()}`;
    bskyCodes.set(code, didFor(handle));
    const back = new URL(redirect);
    back.search = new URLSearchParams({ code, state, iss: BSKY_ORIGIN }).toString();
    return new Response(null, { status: 302, headers: { location: back.toString() } });
  }
  if (request.method === 'POST' && p === '/oauth/token') {
    if (!request.headers.get('dpop')) return json({ error: 'invalid_dpop_proof' }, 400);
    const f = await form(request);
    const sub = f.get('grant_type') === 'authorization_code' ? bskyCodes.get(f.get('code') ?? '') : [...social.dids.values()][0];
    if (!sub) return json({ error: 'invalid_grant' }, 400);
    return json({ access_token: `btok-${id()}`, refresh_token: `bref-${id()}`, token_type: 'DPoP', expires_in: 3600, scope: 'atproto transition:generic', sub });
  }
  if (request.method === 'POST' && p === '/oauth/revoke') return json({});
  if (request.method === 'POST' && p === '/xrpc/com.atproto.repo.uploadBlob') {
    return json({ blob: { $type: 'blob', ref: { $link: `bafk${id()}` }, mimeType: request.headers.get('content-type') ?? 'application/octet-stream', size: 1 } });
  }
  if (request.method === 'POST' && p === '/xrpc/com.atproto.repo.createRecord') {
    if (!request.headers.get('authorization')?.startsWith('DPoP ') || !request.headers.get('dpop')) return json({ error: 'InvalidToken' }, 401);
    const fail = injected('bluesky');
    if (fail) return fail;
    const body = (await request.json().catch(() => ({}))) as { repo?: string; record?: { text?: string; embed?: { $type?: string; external?: { uri?: string } } } };
    const rkey = id();
    social.posts.push({
      network: 'bluesky',
      id: rkey,
      account: body.repo ?? '',
      text: body.record?.text ?? '',
      media: body.record?.embed?.$type === 'app.bsky.embed.video',
      link: body.record?.embed?.external?.uri,
      at: now(),
    });
    return json({ uri: `at://${body.repo}/app.bsky.feed.post/${rkey}`, cid: `bafy${rkey}` });
  }
  return json({ error: 'not faked' }, 404);
};

// ---------------------------------------------------------------------------------------------- webhooks
const hooks: FakeHandler = async (request, url) => {
  if (request.method !== 'POST') return new Response('POST only', { status: 405 });
  const status = Number(url.searchParams.get('status') ?? 200);
  social.hooks.push({ path: url.pathname + url.search, headers: Object.fromEntries(request.headers.entries()), body: await request.text(), at: now() });
  return new Response('ok', { status: Number.isInteger(status) && status >= 200 && status < 600 ? status : 200 });
};

export function registerSocialFakes(fakes: Map<string, FakeHandler>): void {
  fakes.set(`.${FAKE_MASTODON_DOMAIN}`, mastodon);
  fakes.set('x.com', xWeb);
  fakes.set('api.x.com', xApi);
  fakes.set('api.telegram.org', telegram);
  fakes.set('public.api.bsky.app', bskyResolver);
  fakes.set('plc.directory', plc);
  fakes.set(FAKE_BSKY_HOST, bsky);
  fakes.set(FAKE_HOOKS_HOST, hooks);
}

/** /__fake/social/… (fake-external.ts control). */
export async function socialControl(method: string, url: URL, body: () => Promise<string>): Promise<Response> {
  const step = url.pathname.slice('/__fake/social/'.length);
  if (method === 'GET' && step === 'posts') {
    const network = url.searchParams.get('network');
    return json(network ? social.posts.filter((p) => p.network === network) : social.posts);
  }
  if (method === 'GET' && step === 'webhooks') return json(social.hooks);
  if (method === 'POST' && step === 'telegram/post') {
    try {
      return await telegramChannelPost(JSON.parse(await body()));
    } catch (error) {
      console.error('[fake-social] telegram/post error:', error);
      return json({ error: 'invalid telegram post request' }, 400);
    }
  }
  if (method === 'POST' && step === 'fail') {
    const network = url.searchParams.get('network') ?? '';
    const status = Number(url.searchParams.get('status') ?? 503);
    const count = Math.max(1, Number(url.searchParams.get('count') ?? 1));
    if (!['x', 'telegram', 'bluesky', 'mastodon'].includes(network) || !Number.isInteger(status)) return json({ error: 'network and status required' }, 400);
    social.failures.set(network, [...(social.failures.get(network) ?? []), ...Array.from({ length: count }, () => status)]);
    return json({ network, queued: social.failures.get(network) });
  }
  return json({ error: 'unknown social control path' }, 404);
}
