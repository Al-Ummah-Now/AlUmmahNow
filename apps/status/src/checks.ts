/**
 * Synthetic checks, one set per component. Every probe is read-only and
 * anonymous: no sign-in, no uploads (the TUS initiate check expects 401
 * without a token), nothing created anywhere. Results go through
 * classify() into a raw component state, then state.ts debounces it.
 */
import type { StatusComponentId } from '@al-ummah/shared-types';

export type StatusEnvName = 'production' | 'stage' | 'qa';

/** One probe's outcome. `skipped`: it could not run (a dependency failed), so it says nothing. */
export interface ProbeResult {
  name: string;
  ok: boolean;
  /** Answered correctly but slower than SLOW_MS, or an upstream status page reports a minor problem */
  degraded?: boolean;
  skipped?: boolean;
  latencyMs: number;
  detail: string;
}

export type RawState = 'operational' | 'degraded' | 'partial' | 'major' | 'unknown';

export interface ComponentResult {
  component: StatusComponentId;
  raw: RawState;
  latencyMs: number | null;
  detail: string;
  probes: ProbeResult[];
}

/** A probe slower than this marks its component degraded. */
export const SLOW_MS = 4000;
/** A probe that has not answered by then failed. */
export const TIMEOUT_MS = 10_000;
const UA = 'al-ummah-status/1.0 (+https://status.alummahnow.net)';

/** `https://<label><env suffix>.alummahnow.net` */
export function host(env: StatusEnvName, label: string): string {
  const suffix = env === 'production' ? '' : `.${env}`;
  return `https://${label}${suffix}.alummahnow.net`;
}

export interface CheckDeps {
  fetch: typeof fetch;
  now?: () => number;
}

type Expect = {
  status: number[];
  /** Checks the body (JSON parsed when the content type says so) */
  body?: (body: unknown, text: string) => boolean;
  /** Checks the Location header of a redirect */
  location?: RegExp;
};

async function timed<T>(deps: CheckDeps, fn: () => Promise<T>): Promise<{ value?: T; error?: unknown; ms: number }> {
  const now = deps.now ?? Date.now;
  const start = now();
  try {
    const value = await fn();
    return { value, ms: now() - start };
  } catch (error) {
    return { error, ms: now() - start };
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error) return error.name === 'TimeoutError' || error.name === 'AbortError' ? `no answer in ${TIMEOUT_MS / 1000} s` : error.message;
  return String(error);
}

export async function httpProbe(deps: CheckDeps, name: string, url: string, expect: Expect, init: RequestInit = {}): Promise<ProbeResult> {
  const r = await timed(deps, async () => {
    const res = await deps.fetch(url, {
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
      ...init,
      headers: { 'user-agent': UA, 'cache-control': 'no-cache', ...(init.headers as Record<string, string> | undefined) },
    });
    const text = expect.body ? await res.text() : '';
    if (!expect.body) await res.body?.cancel();
    return { res, text };
  });
  if (!r.value) return { name, ok: false, latencyMs: r.ms, detail: errorText(r.error) };
  const { res, text } = r.value;
  if (!expect.status.includes(res.status)) return { name, ok: false, latencyMs: r.ms, detail: `HTTP ${res.status}` };
  if (expect.location && !expect.location.test(res.headers.get('location') ?? '')) {
    return { name, ok: false, latencyMs: r.ms, detail: `HTTP ${res.status} to an unexpected place` };
  }
  if (expect.body) {
    let body: unknown = text;
    if ((res.headers.get('content-type') ?? '').includes('json')) {
      try {
        body = JSON.parse(text);
      } catch {
        return { name, ok: false, latencyMs: r.ms, detail: 'invalid JSON' };
      }
    }
    if (!expect.body(body, text)) return { name, ok: false, latencyMs: r.ms, detail: `HTTP ${res.status}, unexpected body` };
  }
  return { name, ok: true, degraded: r.ms > SLOW_MS, latencyMs: r.ms, detail: r.ms > SLOW_MS ? `slow (${r.ms} ms)` : `HTTP ${res.status}` };
}

/** Opens a WebSocket (101 Switching Protocols) and closes it at once. */
export async function wsProbe(deps: CheckDeps, name: string, url: string): Promise<ProbeResult> {
  const r = await timed(deps, () => deps.fetch(url, { headers: { upgrade: 'websocket', 'user-agent': UA }, signal: AbortSignal.timeout(TIMEOUT_MS) }));
  if (!r.value) return { name, ok: false, latencyMs: r.ms, detail: errorText(r.error) };
  const res = r.value as Response & { webSocket?: WebSocket | null };
  if (res.status !== 101) return { name, ok: false, latencyMs: r.ms, detail: `HTTP ${res.status}, no WebSocket` };
  try {
    res.webSocket?.accept();
    res.webSocket?.close(1000, 'status check');
  } catch {
    // Closing is best effort: the handshake already succeeded
  }
  return { name, ok: true, degraded: r.ms > SLOW_MS, latencyMs: r.ms, detail: 'handshake ok' };
}

/** A third party's Atlassian Statuspage (`/api/v2/status.json`): none → ok, minor → degraded, major/critical → down. */
export async function statuspageProbe(deps: CheckDeps, name: string, url: string): Promise<ProbeResult> {
  let indicator = '';
  const p = await httpProbe(deps, name, url, {
    status: [200],
    body: (b) => {
      indicator = String((b as { status?: { indicator?: string } })?.status?.indicator ?? '');
      return ['none', 'minor', 'major', 'critical'].includes(indicator);
    },
  });
  if (!p.ok) return { ...p, skipped: true, detail: `status page unavailable (${p.detail})` };
  if (indicator === 'major' || indicator === 'critical') return { ...p, ok: false, detail: `${name} reports a ${indicator} outage` };
  if (indicator === 'minor') return { ...p, degraded: true, detail: `${name} reports a minor problem` };
  return { ...p, degraded: false, detail: `${name} operational` };
}

const isM3u8 = (_b: unknown, text: string) => text.trimStart().startsWith('#EXTM3U');

interface ListedVideo {
  id?: string;
  playUrl?: string;
  r2?: { status?: string; rev?: string; access?: string };
}

/**
 * Playback: the newest public video's manifests, from R2 (media host) and from
 * Bunny (its signed playUrl). The API gives the URLs, so when the API is down
 * these are skipped (the API component already shows it).
 */
export async function playbackProbes(deps: CheckDeps, env: StatusEnvName): Promise<ProbeResult[]> {
  let videos: ListedVideo[] = [];
  const list = await httpProbe(deps, 'latest public video', `${host(env, 'videos.api')}/api/videos?limit=5`, {
    status: [200],
    body: (b) => {
      videos = ((b as { data?: ListedVideo[] })?.data ?? []).filter((v) => v && typeof v === 'object');
      return Array.isArray((b as { data?: unknown })?.data);
    },
  });
  if (!list.ok) return [{ ...list, ok: false, skipped: true, detail: `videos API unavailable (${list.detail})` }];
  const out: ProbeResult[] = [];
  const r2 = videos.find((v) => v.id && v.r2?.status === 'ready' && v.r2.access === 'pub' && v.r2.rev);
  if (r2) out.push(await httpProbe(deps, 'R2 media manifest', `${host(env, 'media')}/pub/${r2.id}/${r2.r2!.rev}/master.m3u8`, { status: [200], body: isM3u8 }));
  const bunny = videos.find((v) => typeof v.playUrl === 'string' && v.playUrl.startsWith('https://'));
  if (bunny) out.push(await httpProbe(deps, 'Bunny CDN manifest', bunny.playUrl!, { status: [200], body: isM3u8 }));
  if (!out.length) out.push({ name: 'playable video', ok: true, skipped: true, latencyMs: 0, detail: 'no public video to play' });
  return out;
}

const healthy = (b: unknown) => (b as { status?: string })?.status === 'healthy';
const isJson = (b: unknown) => typeof b === 'object' && b !== null;

/** Each component's probes, run in parallel per component. */
export function componentChecks(env: StatusEnvName): Record<StatusComponentId, (deps: CheckDeps) => Promise<ProbeResult[]>> {
  const api = host(env, 'videos.api');
  const auth = host(env, 'auth');
  const all = (...ps: ((d: CheckDeps) => Promise<ProbeResult>)[]) => (d: CheckDeps) => Promise.all(ps.map((p) => p(d)));
  return {
    www: all(
      (d) => httpProbe(d, 'www health', `${host(env, 'www')}/healthz`, { status: [200], body: (b) => (b as { ok?: boolean })?.ok === true }),
      (d) => httpProbe(d, 'www home', `${host(env, 'www')}/en/`, { status: [200] }),
    ),
    videos: all((d) => httpProbe(d, 'videos home', `${host(env, 'videos')}/en`, { status: [200] })),
    api: all(
      (d) => httpProbe(d, 'API health', `${api}/health`, { status: [200], body: healthy }),
      (d) => httpProbe(d, 'video list', `${api}/api/videos?limit=1`, { status: [200], body: isJson }),
    ),
    signin: all(
      (d) => httpProbe(d, 'auth health', `${auth}/health`, { status: [200], body: (b) => (b as { status?: string })?.status === 'ok' }),
      (d) => httpProbe(d, 'OAuth metadata', `${auth}/.well-known/oauth-authorization-server`, { status: [200], body: (b) => typeof (b as { issuer?: unknown })?.issuer === 'string' }),
    ),
    profile: all((d) => httpProbe(d, 'profile sign-in redirect', `${host(env, 'profile.auth')}/login`, { status: [302, 303, 307], location: /\/authorize\?/ })),
    cms: all((d) => httpProbe(d, 'CMS deep health', `${host(env, 'cms')}/healthz?deep=1`, { status: [200], body: (b) => (b as { status?: string })?.status === 'ok' })),
    admin: all((d) => httpProbe(d, 'videos admin sign-in', `${host(env, 'admin')}/login`, { status: [200, 302, 303, 307], location: /auth|login/ })),
    'admin-api': all((d) => httpProbe(d, 'admin API health', `${host(env, 'admin.api')}/health`, { status: [200], body: healthy })),
    'auth-admin': all((d) => httpProbe(d, 'accounts admin sign-in', `${host(env, 'admin.auth')}/`, { status: [302, 303, 307], location: /\/login/ })),
    // No token: the TUS initiate route must refuse with 401, which proves it is up without creating a video
    uploads: all(
      (d) => httpProbe(d, 'TUS initiate (signed out → 401)', `${api}/api/videos/tus`, { status: [401] }, { method: 'POST', headers: { 'tus-resumable': '1.0.0', 'upload-length': '1' } }),
      (d) => statuspageProbe(d, 'bunny.net', 'https://status.bunny.net/api/v2/status.json'),
    ),
    playback: (d) => playbackProbes(d, env),
    live: all(
      (d) => httpProbe(d, 'live streams API', `${api}/api/live-streams?limit=1`, { status: [200], body: (b) => (b as { success?: boolean })?.success === true }),
      // The live edge answers unknown paths with its own 404 (CORS headers): the Worker is up
      (d) => httpProbe(d, 'live edge', `${host(env, 'live')}/`, { status: [200, 404] }),
    ),
    realtime: all(
      (d) => httpProbe(d, 'realtime health', `${host(env, 'realtime')}/health`, { status: [200], body: healthy }),
      (d) => wsProbe(d, 'WebSocket handshake', `${host(env, 'realtime')}/ws`),
    ),
    search: all((d) => httpProbe(d, 'search', `${api}/api/search?q=a&limit=1`, { status: [200], body: isJson })),
    email: all((d) => statuspageProbe(d, 'Resend', 'https://resend-status.com/api/v2/status.json')),
  };
}

/**
 * A component's raw state from its probes: all fine → operational (degraded if
 * any is slow); some failed → partial; all failed → major; nothing ran → unknown.
 */
export function classify(component: StatusComponentId, probes: ProbeResult[]): ComponentResult {
  const ran = probes.filter((p) => !p.skipped);
  const failed = ran.filter((p) => !p.ok);
  let raw: RawState;
  if (!ran.length) raw = 'unknown';
  else if (failed.length === ran.length) raw = 'major';
  else if (failed.length) raw = 'partial';
  else if (ran.some((p) => p.degraded)) raw = 'degraded';
  else raw = 'operational';
  const latencies = ran.filter((p) => p.ok).map((p) => p.latencyMs);
  const detail = (failed.length ? failed : ran.filter((p) => p.degraded)).map((p) => `${p.name}: ${p.detail}`).join('; ') || (ran.length ? 'all checks passed' : probes.map((p) => p.detail).join('; '));
  return { component, raw, latencyMs: latencies.length ? Math.max(...latencies) : null, detail: detail.slice(0, 500), probes };
}

export async function runChecks(env: StatusEnvName, deps: CheckDeps): Promise<ComponentResult[]> {
  const checks = componentChecks(env);
  return Promise.all(
    (Object.keys(checks) as StatusComponentId[]).map(async (id) => {
      try {
        return classify(id, await checks[id](deps));
      } catch (error) {
        return classify(id, [{ name: 'check', ok: false, latencyMs: 0, detail: errorText(error) }]);
      }
    }),
  );
}
