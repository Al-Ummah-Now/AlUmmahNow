/**
 * Fake Google for Move from YouTube on the local stack (wiki AUN-YT-IMPORT): the
 * consent screen, the token endpoint, the YouTube Data API v3 reads the import
 * makes, and YouTube's thumbnail host. Registered in fake-external.ts, so the
 * workers (outbound.ts) and the browser (browser-proxy.ts) both reach it at the
 * real hosts: accounts.google.com, oauth2.googleapis.com, www.googleapis.com /
 * youtube.googleapis.com, i.ytimg.com.
 *
 * The fixture channel "Al-Fajr Channel" (UCaunFixtureChannel0001) has (realistic titles: review shots use them):
 *   AUNytPUB001  public, captions ar + en (and an automatic track that is never imported),
 *                a maxres custom thumbnail, tags, en/ar localizations
 *   AUNytUNL002  unlisted, made for kids
 *   AUNytPRV003  private, scheduled 30 days after the request (publishAt)
 *   playlist PLaunFixture0001 "Tafsir and stories": AUNytPUB001, AUNytUNL002
 * Takeout file names for E2E: "Tafsir Surat Al-Kahf, Part 1 [AUNytPUB001].mp4" etc. (FIXTURE_VIDEOS[].takeoutName).
 *
 * The consent is automatic (Google sends the browser straight back). Control
 * (loopback, PORTS['fake-cdn']):
 *   GET  /__fake/google                      { consent, quota, codes, refreshTokens, revoked, calls }
 *   POST /__fake/google/consent?mode=allow|deny|no-channel|no-captions
 *   POST /__fake/google/quota?on=1|0         captions.list/download answer quotaExceeded
 *   POST /__fake/google/reset
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { ROOT } from './stack.ts';

const THUMBNAIL = join(ROOT, 'apps/web/e2e/test-fixtures/e2e-thumbnail.jpg');
const SCOPE_READONLY = 'https://www.googleapis.com/auth/youtube.readonly';
const SCOPE_CAPTIONS = 'https://www.googleapis.com/auth/youtube.force-ssl';

export const FIXTURE_CHANNEL = { id: 'UCaunFixtureChannel0001', title: 'Al-Fajr Channel', uploads: 'UUaunFixtureChannel0001' };

export const FIXTURE_VIDEOS = [
  {
    id: 'AUNytPUB001',
    takeoutName: 'Tafsir Surat Al-Kahf, Part 1 [AUNytPUB001].mp4',
    title: 'Tafsir Surat Al-Kahf, Part 1',
    description: 'The first part of our tafsir of Surat Al-Kahf.\n\n0:00 Opening\n0:10 The cave',
    privacy: 'public',
    publishedAt: '2024-03-01T09:00:00Z',
    madeForKids: false,
    tags: ['tafsir', 'al-kahf'],
    localizations: { ar: { title: 'تفسير سورة الكهف، الجزء الأول', description: 'الجزء الأول من تفسير سورة الكهف.' }, en: { title: 'Tafsir Surat Al-Kahf, Part 1', description: 'The first part of our tafsir of Surat Al-Kahf.' } },
    captions: [
      { id: 'capPUBar', language: 'ar', trackKind: 'standard' },
      { id: 'capPUBen', language: 'en', trackKind: 'standard' },
      { id: 'capPUBasr', language: 'en', trackKind: 'asr' },
    ],
    thumbnail: true,
  },
  {
    id: 'AUNytUNL002',
    takeoutName: 'Stories of the Prophets for Kids.mp4',
    title: 'Stories of the Prophets for Kids',
    description: 'Stories of the prophets, told for children.',
    privacy: 'unlisted',
    publishedAt: '2024-06-15T12:00:00Z',
    madeForKids: true,
    tags: [],
    localizations: {},
    captions: [],
    thumbnail: false,
  },
  {
    id: 'AUNytPRV003',
    takeoutName: 'Ramadan Reminders, Day 1 [AUNytPRV003].mp4',
    title: 'Ramadan Reminders, Day 1',
    description: 'A short reminder for the first day of Ramadan.',
    privacy: 'private',
    publishedAt: '2026-01-10T08:00:00Z',
    /** publishAt = request time + this (a future schedule whenever the test runs) */
    publishInMs: 30 * 86_400_000,
    madeForKids: false,
    tags: [],
    localizations: {},
    captions: [],
    thumbnail: false,
  },
] as const;

export const FIXTURE_PLAYLIST = { id: 'PLaunFixture0001', title: 'Tafsir and stories', description: 'Tafsir of Surat Al-Kahf and stories of the prophets', privacy: 'public', videoIds: ['AUNytPUB001', 'AUNytUNL002'] };

type ConsentMode = 'allow' | 'deny' | 'no-channel' | 'no-captions';

export const fakeGoogle = {
  consent: 'allow' as ConsentMode,
  quota: false,
  codes: new Map<string, { challenge: string; scope: string; redirectUri: string }>(),
  refreshTokens: new Set<string>(),
  accessTokens: new Set<string>(),
  revoked: new Set<string>(),
  calls: [] as string[],
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const apiError = (status: number, reason: string, message = reason) => json({ error: { code: status, message, errors: [{ reason, message }] } }, status);
const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

function videoResource(v: (typeof FIXTURE_VIDEOS)[number]) {
  const publishAt = 'publishInMs' in v ? new Date(Date.now() + v.publishInMs).toISOString() : undefined;
  const thumbs = v.thumbnail
    ? { default: { url: `https://i.ytimg.com/vi/${v.id}/default.jpg` }, high: { url: `https://i.ytimg.com/vi/${v.id}/hqdefault.jpg` }, maxres: { url: `https://i.ytimg.com/vi/${v.id}/maxresdefault.jpg` } }
    : { default: { url: `https://i.ytimg.com/vi/${v.id}/default.jpg` } };
  return {
    kind: 'youtube#video',
    id: v.id,
    snippet: { title: v.title, description: v.description, publishedAt: v.publishedAt, tags: [...v.tags], defaultLanguage: 'en', thumbnails: thumbs, liveBroadcastContent: 'none' },
    contentDetails: { duration: 'PT40S' },
    status: { privacyStatus: v.privacy, uploadStatus: 'processed', madeForKids: v.madeForKids, ...(publishAt ? { publishAt } : {}) },
    localizations: v.localizations,
  };
}

function bearer(request: Request): string | null {
  const auth = request.headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  return fakeGoogle.accessTokens.has(token) ? token : null;
}

/** accounts.google.com: the consent screen, answered at once. */
export function googleAccounts(request: Request, url: URL): Response {
  if (url.pathname !== '/o/oauth2/v2/auth') return json({ error: 'not_found' }, 404);
  const redirectUri = url.searchParams.get('redirect_uri') ?? '';
  const state = url.searchParams.get('state') ?? '';
  const challenge = url.searchParams.get('code_challenge') ?? '';
  if (!url.searchParams.get('client_id') || !redirectUri || url.searchParams.get('code_challenge_method') !== 'S256' || !challenge) {
    return new Response('Error 400: invalid_request', { status: 400 });
  }
  fakeGoogle.calls.push('consent');
  const back = new URL(redirectUri);
  back.searchParams.set('state', state);
  if (fakeGoogle.consent === 'deny') back.searchParams.set('error', 'access_denied');
  else {
    const asked = (url.searchParams.get('scope') ?? '').split(' ').filter(Boolean);
    const granted = fakeGoogle.consent === 'no-captions' ? asked.filter((s) => s !== SCOPE_CAPTIONS) : asked;
    const code = `fake-code-${randomUUID()}`;
    fakeGoogle.codes.set(code, { challenge, scope: granted.join(' '), redirectUri });
    back.searchParams.set('code', code);
    back.searchParams.set('scope', granted.join(' '));
  }
  return new Response(null, { status: 302, headers: { location: back.toString() } });
}

function newAccessToken(): string {
  const token = `fake-at-${randomUUID()}`;
  fakeGoogle.accessTokens.add(token);
  return token;
}

/** oauth2.googleapis.com: /token (code with PKCE, refresh) and /revoke. */
export async function googleOAuth(request: Request, url: URL): Promise<Response> {
  const form = new URLSearchParams(request.method === 'POST' ? await request.text() : '');
  if (url.pathname === '/revoke') {
    const token = form.get('token') ?? url.searchParams.get('token') ?? '';
    fakeGoogle.calls.push('revoke');
    if (!fakeGoogle.refreshTokens.has(token)) return json({ error: 'invalid_token' }, 400);
    fakeGoogle.refreshTokens.delete(token);
    fakeGoogle.revoked.add(token);
    return json({});
  }
  if (url.pathname !== '/token' || request.method !== 'POST') return json({ error: 'not_found' }, 404);
  if (!form.get('client_id') || !form.get('client_secret')) return json({ error: 'invalid_client' }, 401);
  if (form.get('grant_type') === 'authorization_code') {
    const code = fakeGoogle.codes.get(form.get('code') ?? '');
    fakeGoogle.codes.delete(form.get('code') ?? '');
    const verifier = form.get('code_verifier') ?? '';
    if (!code || code.redirectUri !== form.get('redirect_uri') || b64url(createHash('sha256').update(verifier).digest()) !== code.challenge) {
      return json({ error: 'invalid_grant' }, 400);
    }
    fakeGoogle.calls.push('token:code');
    const refresh = `fake-rt-${randomUUID()}`;
    fakeGoogle.refreshTokens.add(refresh);
    return json({ access_token: newAccessToken(), refresh_token: refresh, expires_in: 3599, scope: code.scope || SCOPE_READONLY, token_type: 'Bearer' });
  }
  if (form.get('grant_type') === 'refresh_token') {
    if (!fakeGoogle.refreshTokens.has(form.get('refresh_token') ?? '')) return json({ error: 'invalid_grant', error_description: 'Token has been expired or revoked.' }, 400);
    fakeGoogle.calls.push('token:refresh');
    return json({ access_token: newAccessToken(), expires_in: 3599, scope: SCOPE_READONLY, token_type: 'Bearer' });
  }
  return json({ error: 'unsupported_grant_type' }, 400);
}

/** www.googleapis.com / youtube.googleapis.com: the YouTube Data API v3 reads. */
export function youtubeApi(request: Request, url: URL): Response {
  if (!url.pathname.startsWith('/youtube/v3/')) return json({ error: 'not_found' }, 404);
  if (!bearer(request)) return apiError(401, 'authError', 'Invalid Credentials');
  const resource = url.pathname.slice('/youtube/v3/'.length);
  const q = url.searchParams;
  fakeGoogle.calls.push(`api:${resource.split('/')[0]}`);
  if (resource === 'channels') {
    if (fakeGoogle.consent === 'no-channel') return json({ kind: 'youtube#channelListResponse', items: [] });
    return json({
      items: [
        {
          id: FIXTURE_CHANNEL.id,
          snippet: { title: FIXTURE_CHANNEL.title, thumbnails: { default: { url: `https://i.ytimg.com/ch/${FIXTURE_CHANNEL.id}/default.jpg` } } },
          contentDetails: { relatedPlaylists: { uploads: FIXTURE_CHANNEL.uploads } },
          statistics: { videoCount: String(FIXTURE_VIDEOS.length) },
        },
      ],
    });
  }
  if (resource === 'playlistItems') {
    const list = q.get('playlistId') === FIXTURE_CHANNEL.uploads ? FIXTURE_VIDEOS.map((v) => v.id) : q.get('playlistId') === FIXTURE_PLAYLIST.id ? FIXTURE_PLAYLIST.videoIds : null;
    if (!list) return apiError(404, 'playlistNotFound');
    // Pages of 2, so the import walks pageTokens
    const start = Number(q.get('pageToken') ?? 0) || 0;
    const page = list.slice(start, start + 2);
    return json({ items: page.map((videoId) => ({ contentDetails: { videoId } })), ...(start + 2 < list.length ? { nextPageToken: String(start + 2) } : {}) });
  }
  if (resource === 'videos') {
    const ids = (q.get('id') ?? '').split(',');
    return json({ items: FIXTURE_VIDEOS.filter((v) => ids.includes(v.id)).map(videoResource) });
  }
  if (resource === 'playlists') {
    return json({ items: [{ id: FIXTURE_PLAYLIST.id, snippet: { title: FIXTURE_PLAYLIST.title, description: FIXTURE_PLAYLIST.description }, status: { privacyStatus: FIXTURE_PLAYLIST.privacy }, contentDetails: { itemCount: FIXTURE_PLAYLIST.videoIds.length } }] });
  }
  if (resource === 'captions') {
    if (fakeGoogle.quota) return apiError(403, 'quotaExceeded', 'The request cannot be completed because you have exceeded your quota.');
    const video = FIXTURE_VIDEOS.find((v) => v.id === q.get('videoId'));
    return json({ items: (video?.captions ?? []).map((c) => ({ id: c.id, snippet: { videoId: video!.id, language: c.language, trackKind: c.trackKind, name: '', isDraft: false, status: 'serving' } })) });
  }
  if (resource.startsWith('captions/')) {
    if (fakeGoogle.quota) return apiError(403, 'quotaExceeded');
    const id = decodeURIComponent(resource.slice('captions/'.length));
    const track = FIXTURE_VIDEOS.flatMap((v) => v.captions as readonly { id: string; language: string }[]).find((c) => c.id === id);
    if (!track) return apiError(404, 'captionNotFound');
    const line = track.language === 'ar' ? 'مرحبًا بكم' : 'Welcome';
    return new Response(`WEBVTT\n\n00:00:00.000 --> 00:00:04.000\n${line}\n\n00:00:04.000 --> 00:00:08.000\n${track.language} fixture caption\n`, { headers: { 'content-type': 'text/vtt' } });
  }
  return apiError(404, 'notFound');
}

/** i.ytimg.com: every thumbnail is the E2E fixture image. */
export function ytimg(request: Request, url: URL): Response {
  if (!/^\/(vi|ch)\//.test(url.pathname)) return new Response('not found', { status: 404 });
  return new Response(readFileSync(THUMBNAIL), { headers: { 'content-type': 'image/jpeg' } });
}

/** Control: GET state, POST consent/quota/reset. */
export function googleControl(method: string | undefined, url: URL): Response {
  const [, , , action] = url.pathname.split('/');
  if (method === 'POST' && action === 'consent') {
    const mode = url.searchParams.get('mode') as ConsentMode;
    if (!['allow', 'deny', 'no-channel', 'no-captions'].includes(mode)) return json({ error: 'mode=allow|deny|no-channel|no-captions' }, 400);
    fakeGoogle.consent = mode;
  } else if (method === 'POST' && action === 'quota') fakeGoogle.quota = url.searchParams.get('on') === '1';
  else if (method === 'POST' && action === 'reset') {
    fakeGoogle.consent = 'allow';
    fakeGoogle.quota = false;
    fakeGoogle.codes.clear();
    fakeGoogle.calls.length = 0;
  } else if (method !== 'GET' || action) return json({ error: 'GET /__fake/google, POST /__fake/google/consent|quota|reset' }, 400);
  return json({
    consent: fakeGoogle.consent,
    quota: fakeGoogle.quota,
    codes: fakeGoogle.codes.size,
    refreshTokens: fakeGoogle.refreshTokens.size,
    revoked: fakeGoogle.revoked.size,
    calls: fakeGoogle.calls.slice(-200),
  });
}
