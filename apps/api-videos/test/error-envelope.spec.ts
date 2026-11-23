/**
 * The error envelope (wiki AUN-FEATURES §5.2, decision O40): every error answer carries a stable
 * code, a localized message in the caller's language, an action and, when known, retryAfter and a
 * reference; no internals reach the caller; `feature_off` names the feature.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Hono } from 'hono';
import {
	API_ERROR_CATALOGUE,
	buildErrorEnvelope,
	negotiateErrorLang,
	parseApiError,
	FEATURE_OFF_BODY,
} from '@al-ummah/shared-types';
import { errorEnvelope } from '../src/middleware/error-envelope';
import { errorHandler } from '../src/middleware/error-handler';
import { featureOff } from '../src/lib/features/off';

const LATIN = /[A-Za-z]/;

describe('negotiateErrorLang', () => {
	it('takes the first en/ar tag by quality, then X-App-Locale, then English', () => {
		assert.equal(negotiateErrorLang('ar-EG,ar;q=0.9,en;q=0.8'), 'ar');
		assert.equal(negotiateErrorLang('en-US,en;q=0.9,ar;q=0.8'), 'en');
		assert.equal(negotiateErrorLang('fr-FR,ar;q=0.5,en;q=0.4'), 'ar');
		assert.equal(negotiateErrorLang('en;q=0.2,ar;q=0.7'), 'ar');
		assert.equal(negotiateErrorLang('ar;q=0,en'), 'en');
		assert.equal(negotiateErrorLang('fr', 'ar'), 'ar');
		assert.equal(negotiateErrorLang(null, 'ar_SA'), 'ar');
		assert.equal(negotiateErrorLang('*', null), 'en');
		assert.equal(negotiateErrorLang(undefined, undefined), 'en');
	});
});

describe('the catalogue', () => {
	it('has both languages, whole sentences, the Arabic glossary and no Latin in Arabic', () => {
		for (const [code, entry] of Object.entries(API_ERROR_CATALOGUE)) {
			assert.match(code, /^[a-z][a-z0-9_]+$/);
			assert.match(entry.en, /[.]$/, `${code}.en ends in a full stop`);
			assert.match(entry.ar, /[.]$/, `${code}.ar ends in a full stop`);
			assert.ok(!/['"]/.test(entry.en), `${code}.en has a straight quote`);
			assert.ok(!LATIN.test(entry.ar), `${code}.ar has Latin letters`);
			assert.ok(!/[0-9,"]/.test(entry.ar), `${code}.ar has an ASCII digit, Latin comma or straight quote`);
			assert.ok(!/فيديو/.test(entry.ar), `${code}.ar uses «فيديو»`);
		}
	});
});

describe('buildErrorEnvelope', () => {
	it('keeps old fields and adds code, message, lang and action', () => {
		const out = buildErrorEnvelope({ success: false, error: 'Video not found' }, { status: 404, lang: 'ar' });
		assert.equal(out.code, 'not_found');
		assert.equal(out.message, API_ERROR_CATALOGUE.not_found.ar);
		assert.equal(out.lang, 'ar');
		assert.equal(out.action, 'none');
		assert.equal(out.error, 'Video not found');
	});

	it('reads a snake_case error as the code', () => {
		const out = buildErrorEnvelope({ success: false, error: 'rate_limited' }, { status: 429, lang: 'en', retryAfterHeader: '30' });
		assert.equal(out.code, 'rate_limited');
		assert.equal(out.action, 'retry');
		assert.equal(out.retryAfter, 30);
	});

	it('keeps an English endpoint message for an uncatalogued code, never for Arabic callers', () => {
		const body = { success: false, code: 'handle_taken', message: 'That handle is taken.' };
		assert.equal(buildErrorEnvelope(body, { status: 409, lang: 'en' }).message, 'That handle is taken.');
		const ar = buildErrorEnvelope(body, { status: 409, lang: 'ar' });
		assert.equal(ar.code, 'handle_taken');
		assert.equal(ar.message, API_ERROR_CATALOGUE.conflict.ar);
	});

	it('keeps a message the endpoint already localized', () => {
		const out = buildErrorEnvelope({ success: false, code: 'x_y', message: 'نص', lang: 'ar' }, { status: 400, lang: 'en' });
		assert.equal(out.message, 'نص');
		assert.equal(out.lang, 'ar');
	});

	it('names the feature in feature_off', () => {
		const out = buildErrorEnvelope({ ...FEATURE_OFF_BODY, feature: 'live' }, { status: 404, lang: 'en' });
		assert.equal(out.code, 'feature_off');
		assert.equal(out.message, 'Live streaming isn’t available right now.');
		assert.equal(out.feature, 'live');
		assert.equal(out.action, 'none');
		const unknown = buildErrorEnvelope({ ...FEATURE_OFF_BODY, feature: 'nope' }, { status: 404, lang: 'ar' });
		assert.equal(unknown.message, 'هذه الميزة غير متاحة الآن.');
		assert.ok(!('feature' in unknown));
	});

	it('turns a chanfana field list into invalid_request', () => {
		const out = buildErrorEnvelope({ success: false, errors: [{ code: 'invalid_type', path: ['title'] }] }, { status: 400, lang: 'en' });
		assert.equal(out.code, 'invalid_request');
		assert.deepEqual(out.errors, [{ code: 'invalid_type', path: ['title'] }]);
	});

	it('never shows a 5xx endpoint message, and asks to sign in on 401', () => {
		const five = buildErrorEnvelope({ success: false, error: 'D1_ERROR: no such table', message: 'D1_ERROR: no such table' }, { status: 500, lang: 'en', referenceHeader: 'ERR-ABCD-EFGH' });
		assert.equal(five.code, 'server_error');
		assert.equal(five.message, API_ERROR_CATALOGUE.server_error.en);
		assert.equal(five.reference, 'ERR-ABCD-EFGH');
		assert.equal(buildErrorEnvelope({ success: false, error: 'Unauthorized' }, { status: 401, lang: 'en' }).action, 'sign_in');
	});

	it('drops a non-https helpUrl and a bad action', () => {
		const out = buildErrorEnvelope({ success: false, code: 'forbidden', helpUrl: 'javascript:alert(1)', action: 'explode' }, { status: 403, lang: 'en' });
		assert.ok(!('helpUrl' in out));
		assert.equal(out.action, 'none');
	});
});

describe('parseApiError', () => {
	it('reads an envelope and degrades on anything else', () => {
		const p = parseApiError(404, { success: false, code: 'feature_off', message: 'x.', lang: 'en', action: 'none', feature: 'live' });
		assert.equal(p.code, 'feature_off');
		assert.equal(p.message, 'x.');
		assert.equal(p.feature, 'live');
		const old = parseApiError(500, { error: 'Internal server error' });
		assert.equal(old.code, 'http_500');
		assert.equal(old.message, undefined);
		assert.equal(parseApiError(502, 'Bad gateway').code, 'http_502');
	});
});

describe('errorEnvelope middleware', () => {
	const app = new Hono();
	app.onError(errorHandler);
	app.use('*', errorEnvelope);
	app.get('/ok', (c) => c.json({ success: true }));
	app.get('/off', (c) => featureOff(c, 'upload'));
	app.get('/limited', (c) => c.json({ success: false, error: 'rate_limited' }, 429, { 'Retry-After': '12' }));
	app.get('/boom', () => {
		throw new Error('secret binding SEARCH_DB exploded');
	});
	app.get('/text', (c) => c.text('nope', 400));
	app.get('/list', (c) => c.json([1, 2], 400));

	const get = (path: string, headers: Record<string, string> = {}) => app.request(`https://videos.api.example${path}`, { headers });

	it('leaves successes alone', async () => {
		const res = await get('/ok');
		assert.deepEqual(await res.json(), { success: true });
		assert.equal(res.headers.get('vary'), null);
	});

	it('localizes feature_off and keeps the 404 and no-store', async () => {
		const res = await get('/off', { 'Accept-Language': 'ar' });
		assert.equal(res.status, 404);
		assert.equal(res.headers.get('cache-control'), 'private, no-store');
		assert.match(res.headers.get('vary') ?? '', /Accept-Language/);
		assert.equal(res.headers.get('content-language'), 'ar');
		const body = await res.json();
		assert.equal(body.code, 'feature_off');
		assert.equal(body.feature, 'upload');
		assert.equal(body.lang, 'ar');
		assert.ok(body.message.length > 0 && !LATIN.test(body.message));
	});

	it('uses X-App-Locale when there is no Accept-Language', async () => {
		const body = await (await get('/limited', { 'X-App-Locale': 'ar' })).json();
		assert.equal(body.lang, 'ar');
		assert.equal(body.retryAfter, 12);
		assert.equal(body.action, 'retry');
	});

	it('wraps a thrown error without leaking it', async () => {
		const res = await get('/boom');
		assert.equal(res.status, 500);
		const text = await res.text();
		assert.ok(!text.includes('SEARCH_DB'), text);
		const body = JSON.parse(text);
		assert.equal(body.code, 'server_error');
		assert.equal(body.action, 'retry');
		assert.equal(body.error, 'Internal server error');
		assert.equal(body.reference, res.headers.get('x-error-ref'));
	});

	it('leaves non-JSON and non-object bodies alone', async () => {
		assert.equal(await (await get('/text')).text(), 'nope');
		assert.deepEqual(await (await get('/list')).json(), [1, 2]);
	});
});
