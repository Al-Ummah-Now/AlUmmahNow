/**
 * Anonymous prayer times and Hijri dates (wiki Epic 21 §3, E21-D1 and E21-D2). Every provider call
 * is mocked: no live AlAdhan request in CI. Covers the city catalogue, fixed month windows,
 * per-country methods, parsing to UTC, Hijri parts, the R2 last-good copy, coalescing, the D1 gate
 * (cap, backoff, breaker with a single probe, lease takeover), stale serving, 503 with nothing
 * known, and that nothing about the caller reaches the provider.
 */
import { afterEach, describe, it, mock } from 'node:test';
import assert from 'node:assert/strict';
import { SignJWT, exportJWK, generateKeyPair } from 'jose';
import { FIRST_PARTY_CLIENT_IDS, writeFeatureSwitch } from '@al-ummah/shared-types';
import worker from '../src/index';
import { HijriMonthGet, PrayerTimesGet, setPrayerSettingsForTests } from '../src/endpoints/prayer/prayerTimes';
import { forgetFeatureCaches } from '../src/lib/features';
import { logger } from '../src/lib/logger';
import { __resetClientForTests } from '../src/lib/openauth-client';
import { aladhanProvider, parseCalendar, ProviderError } from '../src/lib/prayer/aladhan';
import { findCity } from '../src/lib/prayer/cities';
import { resolveMethod } from '../src/lib/prayer/methods';
import { acquire, release, OPEN_AFTER, OPEN_MS, LEASE_MS } from '../src/lib/prayer/gate';
import { allowedMonth, prayerKey, prayerMonth, type PrayerSettings } from '../src/lib/prayer/service';
import { SqliteD1 } from './search-sqlite-d1';
import { MemoryBucket, buildApp } from './helpers';

const MAKKAH = '104515';

function monthBody(month: string, offset = '+03:00') {
	const [y, m] = month.split('-').map(Number);
	const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
	return {
		code: 200,
		data: Array.from({ length: days }, (_, i) => {
			const d = String(i + 1).padStart(2, '0');
			const day = `${y}-${String(m).padStart(2, '0')}-${d}`;
			const t = (hhmm: string) => `${day}T${hhmm}:00${offset} (${offset.slice(0, 3)})`;
			return {
				timings: { Fajr: t('05:10'), Sunrise: t('06:28'), Dhuhr: t('11:52'), Asr: t('15:01'), Maghrib: t('17:16'), Isha: t('18:46') },
				date: { gregorian: { date: `${d}-${String(m).padStart(2, '0')}-${y}` }, hijri: { day: String(((i + 10) % 30) + 1).padStart(2, '0'), month: { number: 5 }, year: '1448' } },
			};
		}),
	};
}

function mockFetch(responder: (url: string) => Response | Promise<Response>) {
	const calls: { url: string; init?: RequestInit }[] = [];
	const fn = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = String(input);
		calls.push({ url, init });
		return responder(url);
	}) as typeof fetch;
	return { fn, calls };
}

function settings(fetchImpl: typeof fetch, limits = { maxInFlight: 4, perSecond: 5 }): PrayerSettings {
	return { provider: aladhanProvider(fetchImpl, 'https://aladhan.test/v1'), hijriSource: 'HJCoSA', limits };
}

function env() {
	return { SEARCH_DB: new SqliteD1() as unknown as D1Database, global_settings: new MemoryBucket() };
}

const app = () =>
	buildApp((r) => {
		r.get('/api/prayer-times', PrayerTimesGet);
		r.get('/api/hijri', HijriMonthGet);
	}, null);

const thisMonth = () => new Date().toISOString().slice(0, 7);

afterEach(() => setPrayerSettingsForTests(null));

describe('city catalogue and methods', () => {
	it('finds a city by id only, and resolves auto per country', async () => {
		const makkah = (await findCity(MAKKAH))!;
		assert.equal(makkah.country, 'SA');
		assert.equal(makkah.timeZone, 'Asia/Riyadh');
		assert.equal(await findCity('0'), null);
		assert.equal(await findCity('21.42,39.82'), null);
		assert.equal(await findCity('999999999'), null);
		assert.equal(resolveMethod('auto', 'SA'), 4);
		assert.equal(resolveMethod('auto', 'EG'), 5);
		assert.equal(resolveMethod('auto', 'ZZ'), 3);
		assert.equal(resolveMethod('auto', 'EG', { EG: 3 }), 3);
		assert.equal(resolveMethod(2, 'SA'), 2);
	});

	it('accepts only calendar months from last month to 12 months ahead', () => {
		const now = new Date('2026-11-23T00:00:00Z');
		assert.equal(allowedMonth('2026-10', now), true);
		assert.equal(allowedMonth('2027-11', now), true);
		assert.equal(allowedMonth('2026-09', now), false);
		assert.equal(allowedMonth('2027-12', now), false);
		assert.equal(allowedMonth('2026-11-01', now), false);
		assert.equal(allowedMonth('2026-13', now), false);
	});
});

describe('AlAdhan adapter', () => {
	it('asks with the city coordinates only and parses UTC instants and numeric Hijri parts', async () => {
		const { fn, calls } = mockFetch(() => Response.json(monthBody('2026-11')));
		const days = await aladhanProvider(fn, 'https://aladhan.test/v1').fetchMonth((await findCity(MAKKAH))!, '2026-11', 4, 'hanafi', 'HJCoSA');
		assert.equal(days.length, 30);
		assert.equal(days[0].date, '2026-11-01');
		assert.equal(days[0].times.fajr, '2026-11-01T02:10:00.000Z');
		assert.deepEqual(days[0].hijri, { day: 11, month: 5, year: 1448 });
		const url = new URL(calls[0].url);
		assert.equal(url.pathname, '/v1/calendar/2026/11');
		assert.equal(url.searchParams.get('school'), '1');
		assert.equal(url.searchParams.get('calendarMethod'), 'HJCoSA');
		assert.equal(url.searchParams.get('iso8601'), 'true');
		assert.deepEqual([...url.searchParams.keys()].sort(), ['calendarMethod', 'iso8601', 'latitude', 'longitude', 'method', 'school', 'timezonestring']);
		const headers = new Headers(calls[0].init?.headers);
		assert.equal(headers.get('cookie'), null);
		assert.equal(headers.get('authorization'), null);
	});

	it('refuses a malformed or short month instead of guessing', () => {
		const body = monthBody('2026-11');
		assert.throws(() => parseCalendar({ ...body, data: body.data.slice(1) }, 30), ProviderError);
		const broken = monthBody('2026-11');
		broken.data[3].timings.Asr = 'soon';
		assert.throws(() => parseCalendar(broken, 30), ProviderError);
	});
});

describe('GET /api/prayer-times', () => {
	it('serves one shared answer per city, month, method and Asr; the second read comes from R2', async () => {
		const e = env();
		const { fn, calls } = mockFetch((url) => Response.json(monthBody(thisMonth())));
		setPrayerSettingsForTests(() => settings(fn));
		const res = await app().request(`/api/prayer-times?city=${MAKKAH}&month=${thisMonth()}`, {}, e as never);
		assert.equal(res.status, 200);
		assert.match(res.headers.get('cache-control') ?? '', /public, max-age=86400/);
		const body = (await res.json()) as any;
		assert.equal(body.data.method, 4);
		assert.equal(body.data.stale, false);
		assert.equal(body.data.city.id, MAKKAH);
		assert.equal(body.data.credits.hijri.name.en, 'High Judicial Council of Saudi Arabia');
		assert.equal(calls.length, 1);
		const again = await app().request(`/api/prayer-times?asr=standard&city=${MAKKAH}&method=auto&month=${thisMonth()}`, {}, e as never);
		assert.equal(again.status, 200);
		assert.equal(calls.length, 1, 'R2 answered, no second provider call');
	});

	it('refuses unknown cities, methods and months outside the window', async () => {
		const e = env();
		setPrayerSettingsForTests(() => settings(mockFetch(() => Response.json({})).fn));
		assert.equal((await app().request(`/api/prayer-times?city=999999999&month=${thisMonth()}`, {}, e as never)).status, 400);
		assert.equal((await app().request(`/api/prayer-times?city=${MAKKAH}&month=${thisMonth()}&method=6`, {}, e as never)).status, 400);
		assert.equal((await app().request(`/api/prayer-times?city=${MAKKAH}&month=2001-01`, {}, e as never)).status, 400);
		assert.equal((await app().request(`/api/prayer-times?city=${MAKKAH}&month=${thisMonth()}-01..${thisMonth()}-30`, {}, e as never)).status, 400);
	});

	it('answers 503 when nothing is known and the provider fails; never invented times', async () => {
		const e = env();
		setPrayerSettingsForTests(() => settings(mockFetch(() => new Response('down', { status: 502 })).fn));
		const res = await app().request(`/api/prayer-times?city=${MAKKAH}&month=${thisMonth()}`, {}, e as never);
		assert.equal(res.status, 503);
		const body = (await res.json()) as any;
		assert.equal(body.code, 'prayer_provider_unavailable');
		assert.equal(JSON.stringify(body).includes('fajr'), false);
	});

	it('serves the last-good copy marked stale when the stored month is old and the provider fails', async () => {
		const e = env();
		const month = thisMonth();
		const key = prayerKey('aladhan', 'HJCoSA', 4, 'standard', MAKKAH, month);
		await e.global_settings.put(key, JSON.stringify({ fetchedAt: '2020-01-01T00:00:00.000Z', provider: 'aladhan', hijriSource: 'HJCoSA', days: [{ date: `${month}-01`, times: { fajr: 'x' }, hijri: { day: 1, month: 1, year: 1448 } }] }));
		setPrayerSettingsForTests(() => settings(mockFetch(() => new Response('', { status: 503 })).fn));
		const res = await app().request(`/api/prayer-times?city=${MAKKAH}&month=${month}`, {}, e as never);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.equal(body.data.stale, true);
		assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
	});

	it('coalesces parallel cold requests for one key into one provider call', async () => {
		const e = env();
		let release!: () => void;
		const gate = new Promise<void>((r) => (release = r));
		const { fn, calls } = mockFetch(async () => {
			await gate;
			return Response.json(monthBody(thisMonth()));
		});
		const s = settings(fn);
		const city = (await findCity(MAKKAH))!;
		const all = Array.from({ length: 8 }, () => prayerMonth(e as never, s, { city, month: thisMonth(), method: 4, asr: 'standard' }));
		await new Promise((r) => setTimeout(r, 20));
		release();
		const results = await Promise.all(all);
		assert.equal(calls.length, 1);
		assert.ok(results.every((r) => r && r.days.length > 0));
	});

	it('over the cap a request waits for a slot instead of failing at once', async () => {
		const e = env();
		let releaseFirst!: () => void;
		const slow = new Promise<void>((r) => (releaseFirst = r));
		let n = 0;
		const { fn, calls } = mockFetch(async () => {
			if (n++ === 0) await slow;
			return Response.json(monthBody(thisMonth()));
		});
		const s = settings(fn, { maxInFlight: 1, perSecond: 100 });
		const makkah = (await findCity(MAKKAH))!;
		const cairo = (await findCity('360630'))!;
		const first = prayerMonth(e as never, s, { city: makkah, month: thisMonth(), method: 4, asr: 'standard' });
		await new Promise((r) => setTimeout(r, 30));
		const second = prayerMonth(e as never, s, { city: cairo, month: thisMonth(), method: 5, asr: 'standard' });
		setTimeout(() => releaseFirst(), 300);
		const [a, b] = await Promise.all([first, second]);
		assert.ok(a && b, 'both answered');
		assert.equal(calls.length, 2);
	});

	it('the Hijri route uses the same proxy and cache', async () => {
		const e = env();
		const month = thisMonth();
		const [y, m] = month.split('-').map(Number);
		const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
		const { fn, calls } = mockFetch(() =>
			Response.json({ code: 200, data: Array.from({ length: days }, (_, i) => ({ gregorian: { date: `${String(i + 1).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}` }, hijri: { day: String(i + 1), month: { number: 6 }, year: '1448' } })) }),
		);
		setPrayerSettingsForTests(() => settings(fn));
		const res = await app().request(`/api/hijri?month=${month}`, {}, e as never);
		assert.equal(res.status, 200);
		const body = (await res.json()) as any;
		assert.deepEqual(body.data.days[0].hijri, { day: 1, month: 6, year: 1448 });
		assert.match(calls[0].url, /\/gToHCalendar\/\d+\/\d{4}\?calendarMethod=HJCoSA$/);
	});
});

describe('provider gate', () => {
	it('one lease per key; an expired lease is taken over', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const now = 1_000_000;
		const first = await acquire(db, 'aladhan', 'k', { maxInFlight: 4, perSecond: 5 }, now);
		assert.equal(first.ok, true);
		assert.deepEqual(await acquire(db, 'aladhan', 'k', { maxInFlight: 4, perSecond: 5 }, now + 1), { ok: false, reason: 'busy' });
		const later = await acquire(db, 'aladhan', 'k', { maxInFlight: 4, perSecond: 5 }, now + LEASE_MS + 1);
		assert.equal(later.ok, true, 'a dead isolate never wedges a key');
	});

	it('caps starts per second and calls in flight', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const now = 2_000_000;
		const limits = { maxInFlight: 2, perSecond: 5 };
		assert.equal((await acquire(db, 'aladhan', 'a', limits, now)).ok, true);
		assert.equal((await acquire(db, 'aladhan', 'b', limits, now)).ok, true);
		assert.deepEqual(await acquire(db, 'aladhan', 'c', limits, now), { ok: false, reason: 'over_cap' });
		const perSecond = { maxInFlight: 100, perSecond: 1 };
		const db2 = new SqliteD1() as unknown as D1Database;
		assert.equal((await acquire(db2, 'aladhan', 'a', perSecond, now)).ok, true);
		assert.deepEqual(await acquire(db2, 'aladhan', 'b', perSecond, now + 10), { ok: false, reason: 'over_cap' });
		assert.equal((await acquire(db2, 'aladhan', 'b', perSecond, now + 1001)).ok, true);
	});

	it('backs off on Retry-After, opens after repeated failures, and lets exactly one probe through', async () => {
		const db = new SqliteD1() as unknown as D1Database;
		const limits = { maxInFlight: 100, perSecond: 100 };
		let now = 3_000_000;
		const first = await acquire(db, 'aladhan', 'k', limits, now);
		assert.ok(first.ok);
		await release(db, 'aladhan', 'k', first.leaseId, { ok: false, retryAfterMs: 30_000, counts: true }, now);
		assert.deepEqual(await acquire(db, 'aladhan', 'k', limits, now + 1000), { ok: false, reason: 'backoff' });
		for (let i = 1; i < OPEN_AFTER; i++) {
			now += 400_000;
			const g = await acquire(db, 'aladhan', `k${i}`, limits, now);
			assert.ok(g.ok, `attempt ${i}`);
			await release(db, 'aladhan', `k${i}`, g.leaseId, { ok: false, retryAfterMs: null, counts: true }, now);
		}
		assert.deepEqual(await acquire(db, 'aladhan', 'x', limits, now + 1000), { ok: false, reason: 'circuit_open' });
		now += OPEN_MS + 1;
		const probe = await acquire(db, 'aladhan', 'p1', limits, now);
		assert.ok(probe.ok && probe.probe, 'one probe');
		assert.deepEqual(await acquire(db, 'aladhan', 'p2', limits, now), { ok: false, reason: 'circuit_open' }, 'only one probe');
		await release(db, 'aladhan', 'p1', probe.leaseId, { ok: true }, now);
		assert.equal((await acquire(db, 'aladhan', 'p3', limits, now + 1)).ok, true, 'closed again');
	});
});

describe('anonymous contract through the real Worker entry', () => {
	it('ignores Authorization and channelId on /api and /api/v1 prayer and Hijri routes, never logs userId, and rate-limits by IP', async () => {
		__resetClientForTests();
		forgetFeatureCaches();
		const realFetch = globalThis.fetch;
		const qaIssuer = 'https://auth.qa.alummahnow.net';
		const { publicKey, privateKey } = await generateKeyPair('ES256');
		const jwk = { ...(await exportJWK(publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
		const token = await new SignJWT({ mode: 'access', type: 'user', properties: { id: 'usr_signed_in', email: 'viewer@example.com' } })
			.setProtectedHeader({ alg: 'ES256', kid: 'k1' })
			.setIssuer(qaIssuer)
			.setAudience(FIRST_PARTY_CLIENT_IDS.qa.web)
			.setSubject('user:signed-in')
			.setIssuedAt()
			.setExpirationTime('15m')
			.sign(privateKey);

		let authFetchCalls = 0;
		globalThis.fetch = (async (input: RequestInfo | URL) => {
			const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
			if (url.origin === qaIssuer) {
				authFetchCalls++;
				if (url.pathname === '/.well-known/oauth-authorization-server') {
					return Response.json({ issuer: qaIssuer, jwks_uri: `${qaIssuer}/.well-known/jwks.json` });
				}
				if (url.pathname === '/.well-known/jwks.json') return Response.json({ keys: [jwk] });
			}
			return new Response('not found', { status: 404 });
		}) as typeof fetch;

		const requestLogs: Array<Record<string, unknown>> = [];
		const reqMock = mock.method(logger, 'request', (fields: Record<string, unknown>) => {
			requestLogs.push(fields);
		});

		try {
			const month = thisMonth();
			const [y, m] = month.split('-').map(Number);
			const days = new Date(Date.UTC(y, m, 0)).getUTCDate();
			const { fn, calls } = mockFetch((url) => {
				if (url.includes('/gToHCalendar/')) {
					return Response.json({
						code: 200,
						data: Array.from({ length: days }, (_, i) => ({
							gregorian: { date: `${String(i + 1).padStart(2, '0')}-${String(m).padStart(2, '0')}-${y}` },
							hijri: { day: String(i + 1), month: { number: 6 }, year: '1448' },
						})),
					});
				}
				return Response.json(monthBody(month));
			});
			setPrayerSettingsForTests(() => settings(fn));

			const limiterKeys: string[] = [];
			const e = {
				...env(),
				ENVIRONMENT: 'qa',
				Issuer: qaIssuer,
				ClientId: FIRST_PARTY_CLIENT_IDS.qa.web,
				PRAYER_LIMITER: {
					async limit({ key }: { key: string }) {
						limiterKeys.push(key);
						return { success: true };
					},
				},
			};
			await writeFeatureSwitch(e as never, { key: 'prayerTimes', enabled: true, expectedVersion: 0, actorId: 'usr_admin', currentStored: false });
			await writeFeatureSwitch(e as never, { key: 'hijriCalendar', enabled: true, expectedVersion: 0, actorId: 'usr_admin', currentStored: false });
			forgetFeatureCaches();

			const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
			const headers = {
				Authorization: `Bearer ${token}`,
				channelId: 'ch_should_be_ignored',
				Cookie: 'session=secret',
				'CF-Connecting-IP': '203.0.113.42',
			};
			const paths = [
				`/api/prayer-times?city=${MAKKAH}&month=${month}`,
				`/api/v1/prayer-times?city=${MAKKAH}&month=${month}`,
				`/api/hijri?month=${month}`,
				`/api/v1/hijri?month=${month}`,
			];
			for (const path of paths) {
				const res = await worker.fetch(new Request(`https://videos.api.example${path}`, { headers }), e as never, ctx);
				assert.equal(res.status, 200, `${path} answered ${res.status}`);
			}

			assert.equal(authFetchCalls, 0, 'bearer token is never verified on anonymous prayer/Hijri routes');
			assert.deepEqual(limiterKeys, ['ip:203.0.113.42', 'ip:203.0.113.42', 'ip:203.0.113.42', 'ip:203.0.113.42']);
			assert.equal(requestLogs.length, 4);
			for (const entry of requestLogs) {
				assert.equal(entry.userId, undefined, `request log must not carry userId (${String(entry.route)})`);
			}
			assert.equal(calls.length, 2, 'one upstream call for prayer-times and one for hijri; /api/v1 hits R2');
			for (const call of calls) {
				const h = new Headers(call.init?.headers);
				assert.equal(h.get('authorization'), null);
				assert.equal(h.get('cookie'), null);
			}
		} finally {
			reqMock.mock.restore();
			globalThis.fetch = realFetch;
			__resetClientForTests();
			forgetFeatureCaches();
		}
	});
});
