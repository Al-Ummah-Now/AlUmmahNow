/**
 * Quran Foundation calls from api-videos (translated caption tracks, the editions list): granular
 * scopes only, and HTTP 429 honoured (QF 2026-11-21: no fixed limits; back off and honour
 * Retry-After). A fake QF only: never the real network.
 */
import { afterEach, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { QF_SCOPES, ayahTranslation, listTranslationEditions, qfBackoffUntil, resetQfToken } from '../src/lib/quran/translations';

const env = { QF_CLIENT_ID: 'client', QF_CLIENT_SECRET: 'secret', QF_OAUTH_HOST: 'https://oauth.test', QF_API_HOST: 'https://api.test' };
const realNow = Date.now;
let now = Date.parse('2026-11-21T12:00:00.000Z');

interface Fake {
	calls: string[];
	scopes: string[];
	fetch: typeof fetch;
}

/** `answers` per content call, in order; the last repeats. The token endpoint answers `tokenStatus` once if set. */
function fakeQf(answers: Array<() => Response>, opts: { tokenStatus?: number; retryAfter?: string } = {}): Fake {
	const fake: Fake = { calls: [], scopes: [], fetch: undefined as never };
	let i = 0;
	let tokenFailed = false;
	fake.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = new URL(String(input));
		if (url.pathname === '/oauth2/token') {
			fake.calls.push('token');
			fake.scopes.push(new URLSearchParams(String(init?.body)).get('scope') ?? '');
			if (opts.tokenStatus && !tokenFailed) {
				tokenFailed = true;
				return new Response('', { status: opts.tokenStatus, headers: opts.retryAfter ? { 'retry-after': opts.retryAfter } : {} });
			}
			return Response.json({ access_token: 'tok', expires_in: 3600 });
		}
		fake.calls.push(url.pathname);
		return answers[Math.min(i++, answers.length - 1)]!();
	}) as typeof fetch;
	return fake;
}

const verse = (text: string) => () => Response.json({ verse: { translations: [{ resource_id: 20, text }] } });
const busy = (retryAfter?: string) => () => Response.json({ message: 'Too many requests, please try again later', type: 'rate_limit_exceeded' }, { status: 429, headers: retryAfter ? { 'retry-after': retryAfter } : {} });

describe('Quran Foundation from api-videos', () => {
	beforeEach(() => {
		resetQfToken();
		now = Date.parse('2026-11-21T12:00:00.000Z');
		Date.now = () => now;
	});
	afterEach(() => {
		Date.now = realNow;
		resetQfToken();
	});

	it('asks only for the granular display scopes', async () => {
		assert.equal(QF_SCOPES, 'content.quran.read content.translations.read');
		const qf = fakeQf([verse('Say, He is Allah, One')]);
		assert.equal(await ayahTranslation(env, 20, 112, 1, qf.fetch), 'Say, He is Allah, One');
		assert.deepEqual(qf.scopes, ['content.quran.read content.translations.read']);
	});

	it('429 with Retry-After: no call to QF until then (the reference shows meanwhile), then calls again', async () => {
		const qf = fakeQf([busy('120'), verse('Say, He is Allah, One')]);
		assert.equal(await ayahTranslation(env, 20, 112, 1, qf.fetch), null);
		assert.ok(qfBackoffUntil() >= now + 120_000, 'waits at least Retry-After');
		const before = qf.calls.length;
		now += 60_000;
		assert.equal(await ayahTranslation(env, 20, 112, 2, qf.fetch), null);
		assert.equal(await listTranslationEditions(env, 'en', qf.fetch), null);
		assert.equal(qf.calls.length, before, 'nothing is sent while backing off');
		now += 61_000;
		assert.equal(await ayahTranslation(env, 20, 112, 1, qf.fetch), 'Say, He is Allah, One');
		assert.equal(qfBackoffUntil(), 0, 'a success clears the backoff');
	});

	it('429 with an HTTP-date Retry-After waits until that date', async () => {
		const at = new Date(now + 300_000).toUTCString();
		const qf = fakeQf([busy(at)]);
		await ayahTranslation(env, 20, 1, 1, qf.fetch);
		assert.equal(qfBackoffUntil(), now + 300_000);
	});

	it('429 without Retry-After: bounded exponential backoff that grows with each 429', async () => {
		const qf = fakeQf([busy()]);
		await ayahTranslation(env, 20, 1, 1, qf.fetch);
		const first = qfBackoffUntil() - now;
		assert.ok(first >= 500 && first <= 1000, `first wait ${first}`);
		now = qfBackoffUntil();
		await ayahTranslation(env, 20, 1, 1, qf.fetch);
		now = qfBackoffUntil();
		await ayahTranslation(env, 20, 1, 1, qf.fetch);
		const third = qfBackoffUntil() - now;
		assert.ok(third >= 2000 && third <= 4000, `third wait ${third}`);
	});

	it('the token endpoint answering 429 backs off too', async () => {
		const qf = fakeQf([verse('x')], { tokenStatus: 429, retryAfter: '30' });
		assert.equal(await ayahTranslation(env, 20, 1, 1, qf.fetch), null);
		assert.ok(qfBackoffUntil() >= now + 30_000);
		assert.deepEqual(qf.calls, ['token']);
		now += 31_000;
		assert.equal(await ayahTranslation(env, 20, 1, 1, qf.fetch), 'x');
	});
});
