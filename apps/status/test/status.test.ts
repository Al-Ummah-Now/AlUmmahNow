/**
 * Status page: debounce state machine, uptime math, probes and classification,
 * a full check run on SQLite (state, daily counters, alerts open → resolve,
 * maintenance silence), the public model, HTML (en/ar) and feeds.
 * No network: every fetch is a fake.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { STATUS_COMPONENT_IDS } from '@al-ummah/shared-types';
import { classify, componentChecks, host, httpProbe, playbackProbes, statuspageProbe, wsProbe, type ProbeResult } from '../src/checks';
import { advance, dayLevel, effectiveState, formatUptime, lastDays, overallState, uptime, type StoredState } from '../src/state';
import { runOnce, type StatusEnv } from '../src/run';
import { buildSummary, toJson } from '../src/model';
import { renderIncidentPage, renderStatusPage } from '../src/render';
import { atomFeed, rssFeed } from '../src/feed';
import { loadIncident, prune } from '../src/store';
import { sqliteD1 } from './d1-sqlite';

const AT = (m: number) => new Date(Date.UTC(2026, 10, 13, 12, m)).toISOString();

describe('debounce (advance)', () => {
  const ok: StoredState = { state: 'operational', raw: 'operational', streak: 5, since: AT(0) };

  it('first run takes the raw state; unknown starts operational', () => {
    assert.equal(advance(null, 'major', AT(1)).next.state, 'major');
    assert.equal(advance(null, 'unknown', AT(1)).next.state, 'operational');
  });

  it('one failure does not change the state; two in a row do', () => {
    const a = advance(ok, 'major', AT(2));
    assert.equal(a.next.state, 'operational');
    assert.equal(a.changed, false);
    const b = advance(a.next, 'major', AT(4));
    assert.equal(b.next.state, 'major');
    assert.equal(b.changed, true);
    assert.equal(b.next.since, AT(4));
  });

  it('flapping (fail, ok, fail, ok) never changes the state', () => {
    let s = ok;
    for (const [i, raw] of (['major', 'operational', 'major', 'operational'] as const).entries()) {
      const r = advance(s, raw, AT(i));
      assert.equal(r.next.state, 'operational');
      s = r.next;
    }
  });

  it('two different bad results take the milder one', () => {
    const a = advance(ok, 'partial', AT(1));
    assert.equal(advance(a.next, 'major', AT(2)).next.state, 'partial');
  });

  it('recovery also needs two good runs', () => {
    const down: StoredState = { state: 'major', raw: 'major', streak: 3, since: AT(0) };
    const a = advance(down, 'operational', AT(1));
    assert.equal(a.next.state, 'major');
    const b = advance(a.next, 'operational', AT(2));
    assert.equal(b.next.state, 'operational');
    assert.equal(b.changed, true);
  });

  it('unknown runs change nothing and break a streak', () => {
    const a = advance(ok, 'major', AT(1));
    const b = advance(a.next, 'unknown', AT(2));
    assert.equal(b.next.state, 'operational');
    assert.equal(advance(b.next, 'major', AT(3)).next.state, 'operational');
  });

  it('counts the streak of identical raw results', () => {
    assert.equal(advance(ok, 'operational', AT(1)).next.streak, 6);
    assert.equal(advance(ok, 'degraded', AT(1)).next.streak, 1);
  });
});

describe('effective and overall state', () => {
  it('an incident makes a component worse, never better', () => {
    assert.equal(effectiveState('operational', ['partial'], false), 'partial');
    assert.equal(effectiveState('major', ['degraded'], false), 'major');
    assert.equal(effectiveState('operational', ['none'], false), 'operational');
  });
  it('maintenance shows unless the checks see an outage', () => {
    assert.equal(effectiveState('degraded', [], true), 'maintenance');
    assert.equal(effectiveState('major', [], true), 'major');
  });
  it('overall is the worst component', () => {
    assert.equal(overallState(['operational', 'maintenance', 'degraded']), 'degraded');
    assert.equal(overallState(['operational', 'operational']), 'operational');
    assert.equal(overallState(['partial', 'major', 'operational']), 'major');
  });
});

describe('uptime math', () => {
  const z = { operational: 0, degraded: 0, partial: 0, major: 0, maintenance: 0, unknown: 0 };
  it('major counts fully, partial 30%, degraded is up, maintenance and unknown are left out', () => {
    assert.equal(uptime([{ ...z, operational: 90, major: 10 }]), 0.9);
    assert.equal(uptime([{ ...z, operational: 90, partial: 10 }]), 0.97);
    assert.equal(uptime([{ ...z, degraded: 50, operational: 50, maintenance: 100, unknown: 7 }]), 1);
    assert.equal(uptime([{ ...z, maintenance: 3 }]), null);
    assert.equal(uptime([]), null);
  });
  it('sums across days', () => {
    assert.equal(uptime([{ ...z, operational: 100 }, { ...z, operational: 50, major: 50 }]), 0.75);
  });
  it('rounds down so a short outage never shows 100%', () => {
    assert.equal(formatUptime(0.99996), '99.99');
    assert.equal(formatUptime(1), '100.00');
    assert.equal(formatUptime(null), null);
  });
  it('a day bar is the worst state of the day', () => {
    assert.equal(dayLevel({ ...z, operational: 700, major: 1 }), 'major');
    assert.equal(dayLevel({ ...z, operational: 700, degraded: 3 }), 'degraded');
    assert.equal(dayLevel({ ...z, maintenance: 3 }), 'maintenance');
    assert.equal(dayLevel(undefined), 'none');
  });
  it('lists the last 90 UTC days ending today', () => {
    const d = lastDays(new Date('2026-11-13T23:59:00Z'), 90);
    assert.equal(d.length, 90);
    assert.equal(d[89], '2026-11-13');
    assert.equal(d[0], '2026-08-16');
  });
});

/** A fake fetch: routes by URL prefix; unmatched URLs fail like a network error. */
function fakeFetch(routes: Record<string, (req: Request) => Response | Promise<Response>>, calls: string[] = []): typeof fetch {
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input as string, init as RequestInit);
    calls.push(`${req.method} ${req.url}`);
    const key = Object.keys(routes).sort((a, b) => b.length - a.length).find((k) => req.url.startsWith(k));
    if (!key) throw new TypeError('fetch failed');
    return routes[key](req);
  }) as typeof fetch;
}
const json = (b: unknown, status = 200) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json' } });

describe('probes', () => {
  it('builds per-env hosts', () => {
    assert.equal(host('production', 'videos.api'), 'https://videos.api.alummahnow.net');
    assert.equal(host('qa', 'videos.api'), 'https://videos.api.qa.alummahnow.net');
    assert.equal(host('stage', 'www'), 'https://www.stage.alummahnow.net');
  });

  it('http probe checks status, body and redirect target', async () => {
    const f = fakeFetch({
      'https://a/ok': () => json({ status: 'healthy' }),
      'https://a/bad': () => json({ status: 'sick' }),
      'https://a/500': () => new Response('x', { status: 500 }),
      'https://a/redir': () => new Response(null, { status: 302, headers: { location: 'https://auth/authorize?x' } }),
    });
    const healthy = (b: unknown) => (b as { status: string }).status === 'healthy';
    assert.equal((await httpProbe({ fetch: f }, 'n', 'https://a/ok', { status: [200], body: healthy })).ok, true);
    assert.match((await httpProbe({ fetch: f }, 'n', 'https://a/bad', { status: [200], body: healthy })).detail, /unexpected body/);
    assert.equal((await httpProbe({ fetch: f }, 'n', 'https://a/500', { status: [200] })).detail, 'HTTP 500');
    assert.equal((await httpProbe({ fetch: f }, 'n', 'https://a/redir', { status: [302], location: /\/authorize\?/ })).ok, true);
    assert.equal((await httpProbe({ fetch: f }, 'n', 'https://a/redir', { status: [302], location: /nowhere/ })).ok, false);
    assert.equal((await httpProbe({ fetch: f }, 'n', 'https://down/', { status: [200] })).ok, false);
  });

  it('marks a slow answer degraded', async () => {
    let t = 0;
    const now = () => (t += 5000);
    const r = await httpProbe({ fetch: fakeFetch({ 'https://a/': () => new Response('ok') }), now }, 'n', 'https://a/', { status: [200] });
    assert.equal(r.ok, true);
    assert.equal(r.degraded, true);
  });

  it('statuspage probe: none ok, minor degraded, major down, unreachable skipped', async () => {
    const page = (indicator: string) => fakeFetch({ 'https://s/': () => json({ status: { indicator } }) });
    assert.equal((await statuspageProbe({ fetch: page('none') }, 'R', 'https://s/')).degraded, false);
    assert.equal((await statuspageProbe({ fetch: page('minor') }, 'R', 'https://s/')).degraded, true);
    assert.equal((await statuspageProbe({ fetch: page('critical') }, 'R', 'https://s/')).ok, false);
    assert.equal((await statuspageProbe({ fetch: fakeFetch({}) }, 'R', 'https://s/')).skipped, true);
  });

  it('websocket probe needs a 101', async () => {
    assert.equal((await wsProbe({ fetch: fakeFetch({ 'https://r/ws': () => new Response('upgrade', { status: 426 }) }) }, 'ws', 'https://r/ws')).ok, false);
  });

  it('playback reads the newest videos from the API and fetches both manifests; API down → skipped', async () => {
    const calls: string[] = [];
    const f = fakeFetch(
      {
        'https://videos.api.qa.alummahnow.net/api/videos': () => json({ data: [{ id: 'v1', playUrl: 'https://vz.b-cdn.net/tok/v1/playlist.m3u8', r2: { status: 'ready', rev: 'r1', access: 'pub' } }] }),
        'https://media.qa.alummahnow.net/pub/v1/r1/master.m3u8': () => new Response('#EXTM3U\n'),
        'https://vz.b-cdn.net/': () => new Response('#EXTM3U\n'),
      },
      calls,
    );
    const probes = await playbackProbes({ fetch: f }, 'qa');
    assert.deepEqual(probes.map((p) => [p.name, p.ok]), [['R2 media manifest', true], ['Bunny CDN manifest', true]]);
    const down = await playbackProbes({ fetch: fakeFetch({}) }, 'qa');
    assert.equal(classify('playback', down).raw, 'unknown');
  });

  it('uploads never create anything: only an unauthenticated POST that must get 401', async () => {
    const calls: string[] = [];
    const f = fakeFetch({ 'https://videos.api.alummahnow.net/api/videos/tus': () => new Response('', { status: 401 }), 'https://status.bunny.net/': () => json({ status: { indicator: 'none' } }) }, calls);
    const probes = await componentChecks('production').uploads({ fetch: f });
    assert.equal(classify('uploads', probes).raw, 'operational');
    assert.ok(calls.every((c) => !/upload\/initiate/.test(c)));
  });

  it('defines checks for every component', () => {
    assert.deepEqual(Object.keys(componentChecks('qa')).sort(), [...STATUS_COMPONENT_IDS].sort());
  });
});

describe('classify', () => {
  const p = (ok: boolean, extra: Partial<ProbeResult> = {}): ProbeResult => ({ name: 'p', ok, latencyMs: 100, detail: ok ? 'ok' : 'HTTP 500', ...extra });
  it('all ok → operational; slow → degraded; some fail → partial; all fail → major; none ran → unknown', () => {
    assert.equal(classify('api', [p(true), p(true)]).raw, 'operational');
    assert.equal(classify('api', [p(true), p(true, { degraded: true })]).raw, 'degraded');
    assert.equal(classify('api', [p(true), p(false)]).raw, 'partial');
    assert.equal(classify('api', [p(false), p(false)]).raw, 'major');
    assert.equal(classify('api', [p(true, { skipped: true })]).raw, 'unknown');
    assert.equal(classify('api', [p(false), p(true, { skipped: true })]).raw, 'major');
  });
});

/** Every host answers healthy, except the components listed in `down`. */
function platform(down: string[] = []): typeof fetch {
  const isDown = (url: string) => down.some((h) => url.startsWith(h));
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input instanceof Request ? input.url : input);
    if (isDown(url)) return new Response('down', { status: 503 });
    if (url.includes('/ws')) return new Response('need upgrade', { status: 426 });
    if (url.endsWith('/api/videos/tus')) return new Response('', { status: 401 });
    if (url.includes('profile.auth')) return new Response(null, { status: 302, headers: { location: 'https://auth.qa.alummahnow.net/authorize?x' } });
    if (url.includes('admin.qa') && url.endsWith('/login')) return new Response(null, { status: 307, headers: { location: '/api/auth/start' } });
    if (url.includes('status.json')) return json({ status: { indicator: 'none' } });
    if (url.includes('/api/videos?') || url.includes('/api/search')) return json({ data: [] });
    if (url.includes('healthz')) return json({ ok: true, status: 'ok' });
    if (url.endsWith('/health')) return json({ status: url.includes('auth.') ? 'ok' : 'healthy' });
    if (url.includes('oauth-authorization-server')) return json({ issuer: 'x' });
    if (url.includes('live-streams')) return json({ success: true });
    void init;
    return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
  }) as typeof fetch;
}

function statusEnv(db: D1Database): StatusEnv & { posts: unknown[] } {
  const env = { STATUS_DB: db, ENVIRONMENT: 'qa', ERRORS_INGEST_URL: 'https://admin.api.qa.alummahnow.net/internal/errors', INTERNAL_API_KEY: 'k', posts: [] as unknown[] };
  return env;
}

describe('a check run on SQLite', () => {
  it('debounces, counts the day, opens one alert and resolves it', async () => {
    const db = sqliteD1();
    const env = statusEnv(db);
    const posts: { body: { events?: { action?: { key: string } }[]; resolved?: { key: string }[] } }[] = [];
    const withIngest = (f: typeof fetch): typeof fetch =>
      (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).includes('/internal/errors')) {
          posts.push({ body: JSON.parse(String(init?.body)) });
          return new Response('{}', { status: 202 });
        }
        return f(input, init);
      }) as typeof fetch;
    const ctx = { waitUntil: () => undefined };
    const searchDown = withIngest(platform(['https://videos.api.qa.alummahnow.net/api/search']));

    await runOnce(env, ctx, new Date(AT(0)), { fetch: withIngest(platform()) });
    let row = await db.prepare("SELECT * FROM component_state WHERE component = 'search'").first<{ state: string }>();
    assert.equal(row!.state, 'operational');
    // The realtime WebSocket gets 426 in this fake: one of its two probes fails
    assert.equal((await db.prepare("SELECT state FROM component_state WHERE component = 'realtime'").first<{ state: string }>())!.state, 'partial');

    await runOnce(env, ctx, new Date(AT(2)), { fetch: searchDown });
    row = await db.prepare("SELECT * FROM component_state WHERE component = 'search'").first<{ state: string }>();
    assert.equal(row!.state, 'operational', 'one failed run is not an outage');

    await runOnce(env, ctx, new Date(AT(4)), { fetch: searchDown });
    row = await db.prepare("SELECT * FROM component_state WHERE component = 'search'").first<{ state: string; alert_open: number }>();
    assert.equal(row!.state, 'major');
    assert.equal(row!.alert_open, 1);
    await new Promise((r) => setTimeout(r, 10));
    const opened = posts.flatMap((p) => p.body.events ?? []).map((e) => e.action?.key);
    assert.ok(opened.includes('status:search'));

    await runOnce(env, ctx, new Date(AT(6)), { fetch: searchDown });
    await new Promise((r) => setTimeout(r, 10));
    assert.equal(posts.flatMap((p) => p.body.events ?? []).filter((e) => e.action?.key === 'status:search').length, 1, 'alert opened once');

    await runOnce(env, ctx, new Date(AT(8)), { fetch: withIngest(platform()) });
    await runOnce(env, ctx, new Date(AT(10)), { fetch: withIngest(platform()) });
    await new Promise((r) => setTimeout(r, 10));
    row = await db.prepare("SELECT * FROM component_state WHERE component = 'search'").first<{ state: string; alert_open: number }>();
    assert.equal(row!.state, 'operational');
    assert.equal(row!.alert_open, 0);
    assert.ok(posts.some((p) => p.body.resolved?.some((r) => r.key === 'status:search')));

    const day = await db.prepare("SELECT * FROM daily WHERE component = 'search'").first<{ operational: number; major: number }>();
    assert.equal(day!.operational + day!.major, 6);
    assert.equal(day!.major, 3, "runs at :04, :06 and :08 (recovery also needs two good runs)");
  });

  it('a maintenance window silences alerts and counts as maintenance', async () => {
    const db = sqliteD1();
    const env = statusEnv(db);
    await db.prepare(`INSERT INTO incidents (id, kind, title_en, title_ar, status, impact, components, starts_at, ends_at, created_at, created_by, updated_at, updated_by)
      VALUES ('m', 'maintenance', 'Upgrade', 'ترقية', 'in_progress', 'maintenance', '["cms"]', ?, ?, ?, 'u', ?, 'u')`).bind(AT(0), AT(59), AT(0), AT(0)).run();
    const f = platform(['https://cms.qa.alummahnow.net']);
    const ctx = { waitUntil: () => undefined };
    for (const m of [1, 3, 5]) await runOnce(env, ctx, new Date(AT(m)), { fetch: f });
    const row = await db.prepare("SELECT state, alert_open FROM component_state WHERE component = 'cms'").first<{ state: string; alert_open: number }>();
    assert.equal(row!.state, 'major');
    assert.equal(row!.alert_open, 0);
    const day = await db.prepare("SELECT maintenance FROM daily WHERE component = 'cms'").first<{ maintenance: number }>();
    assert.equal(day!.maintenance, 3);
  });
});

async function seeded() {
  const db = sqliteD1();
  const now = new Date('2026-11-13T13:00:00Z');
  await db.prepare(`INSERT INTO component_state VALUES ('playback', 'operational', 'operational', 3, ?, ?, 300, 'ok', 0)`).bind(AT(0), AT(58)).run();
  await db.prepare(`INSERT INTO daily (component, day, operational, major) VALUES ('playback', '2026-11-13', 90, 10)`).run();
  await db.prepare(`INSERT INTO incidents (id, kind, title_en, title_ar, status, impact, components, starts_at, created_at, created_by, updated_at, updated_by)
    VALUES ('i1', 'incident', 'Slow <videos>', 'مرئيات بطيئة', 'identified', 'partial', '["playback"]', ?, ?, 'u', ?, 'u')`).bind(AT(0), AT(0), AT(10)).run();
  await db.prepare(`INSERT INTO incident_updates VALUES ('u1', 'i1', 'identified', 'A slow CDN region.', 'منطقة بطيئة.', ?, 'u')`).bind(AT(10)).run();
  await db.prepare(`INSERT INTO incidents (id, kind, title_en, title_ar, status, impact, components, starts_at, created_at, created_by, updated_at, updated_by, deleted_at, deleted_by)
    VALUES ('gone', 'incident', 'Deleted', 'محذوفة', 'investigating', 'major', '["api"]', ?, ?, 'u', ?, 'u', '2026-10-01T00:00:00Z', 'u')`).bind(AT(0), AT(0), AT(0)).run();
  return { db, now };
}

describe('public model, page and feeds', () => {
  it('applies open incidents to components; deleted incidents are hidden', async () => {
    const { db, now } = await seeded();
    const s = await buildSummary(db, now, 'production');
    const playback = s.components.find((c) => c.id === 'playback')!;
    assert.equal(playback.state, 'partial');
    assert.equal(playback.checked, 'operational');
    assert.equal(playback.uptime90, '90.00');
    assert.equal(playback.days.length, 90);
    assert.equal(s.overall, 'partial');
    assert.deepEqual(s.active.map((i) => i.id), ['i1']);
    assert.equal(s.components.find((c) => c.id === 'api')!.state, 'operational');
    const j = toJson(s);
    assert.equal(j.components.length, STATUS_COMPONENT_IDS.length);
    assert.equal(j.incidents.active[0].title.ar, 'مرئيات بطيئة');
  });

  it('renders en (ltr) and ar (rtl), escapes incident text', async () => {
    const { db, now } = await seeded();
    const s = await buildSummary(db, now, 'production');
    const en = renderStatusPage(s, { locale: 'en', path: '', assetVersion: 'v', environment: 'production' });
    assert.match(en, /<html lang="en" dir="ltr">/);
    assert.match(en, /Slow &lt;videos&gt;/);
    assert.doesNotMatch(en, /<videos>/);
    assert.match(en, /Some systems are having problems/);
    const ar = renderStatusPage(s, { locale: 'ar', path: '', assetVersion: 'v', environment: 'qa' });
    assert.match(ar, /<html lang="ar" dir="rtl">/);
    assert.match(ar, /مرئيات بطيئة/);
    assert.match(ar, /class="env">QA</);
    const page = renderIncidentPage(await loadIncident(db, 'i1'), { locale: 'en', path: '/incidents/i1', assetVersion: 'v', environment: 'production' });
    assert.match(page, /A slow CDN region/);
    assert.equal(await loadIncident(db, 'gone'), null);
  });

  it('feeds list incidents with links per language', async () => {
    const { db, now } = await seeded();
    const list = (await buildSummary(db, now, 'production')).active;
    const atom = atomFeed('ar', 'https://status.alummahnow.net', list, now);
    assert.match(atom, /<feed xmlns="http:\/\/www.w3.org\/2005\/Atom" xml:lang="ar">/);
    assert.match(atom, /<link rel="alternate" href="https:\/\/status\.alummahnow\.net\/ar\/incidents\/i1"\/>/);
    const rss = rssFeed('en', 'https://status.alummahnow.net', list, now);
    assert.match(rss, /<title>Slow &lt;videos&gt; \(Identified\)<\/title>/);
  });

  it('prune keeps 100 days and purges incidents deleted 30+ days ago', async () => {
    const { db, now } = await seeded();
    await db.prepare(`INSERT INTO daily (component, day, operational) VALUES ('api', '2026-07-01', 5)`).run();
    await prune(db, now);
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM daily WHERE day = '2026-07-01'`).first<{ n: number }>())!.n, 0);
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE id = 'gone'`).first<{ n: number }>())!.n, 0);
    assert.equal((await db.prepare(`SELECT COUNT(*) AS n FROM incidents WHERE id = 'i1'`).first<{ n: number }>())!.n, 1);
  });
});
