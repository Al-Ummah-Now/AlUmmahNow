import { test } from 'node:test';
import assert from 'node:assert/strict';
import { THEMES, checkSiteTheme } from '../check-site-theme.ts';
import { SITE_THEMES } from '../../../packages/shared-types/src/site-theme.ts';

/** A fetch that answers the two URLs the check reads, and records what it was asked */
function site(setting: { status?: number; body?: unknown }, html: string) {
	const asked: string[] = [];
	const fetchFn = async (url: string) => {
		asked.push(url);
		if (url.endsWith('/public/site-theme')) {
			const status = setting.status ?? 200;
			return { ok: status < 400, status, json: async () => setting.body, text: async () => JSON.stringify(setting.body) };
		}
		return { ok: true, status: 200, json: async () => ({}), text: async () => html };
	};
	return { fetchFn, asked };
}

test('the release check knows exactly the themes the site has', () => {
	assert.deepEqual([...THEMES].sort(), [...SITE_THEMES].sort());
});

test('passes when the setting and the rendered page are known themes, reading both URLs', async () => {
	const { fetchFn, asked } = site({ body: { theme: 'nahas' } }, '<!doctype html><html lang="en" data-theme="fawanees" dir="ltr">');
	const line = await checkSiteTheme('https://admin.example', 'https://web.example', fetchFn);
	assert.match(line, /Site theme nahas; the site renders fawanees/);
	assert.deepEqual(asked, ['https://admin.example/public/site-theme', 'https://web.example/en']);
});

test('an endpoint error points at the migration', async () => {
	const { fetchFn, asked } = site({ status: 404 }, '');
	await assert.rejects(checkSiteTheme('https://a', 'https://w', fetchFn), /answered 404; has migration 0006 been applied/);
	assert.equal(asked.length, 1, 'the site is not fetched once the setting failed');
});

test('an unknown or missing setting fails', async () => {
	for (const body of [{ theme: 'neon' }, {}, { theme: '' }]) {
		const { fetchFn } = site({ body }, '<html data-theme="fawanees">');
		await assert.rejects(checkSiteTheme('https://a', 'https://w', fetchFn), /Unknown site theme/);
	}
});

test('the first HTML must carry a known data-theme on <html>', async () => {
	const none = site({ body: { theme: 'zujaj' } }, '<html lang="en"><body data-theme="zujaj">');
	await assert.rejects(checkSiteTheme('https://a', 'https://w', none.fetchFn), /no data-theme/);
	const unknown = site({ body: { theme: 'zujaj' } }, '<html data-theme="neon">');
	await assert.rejects(checkSiteTheme('https://a', 'https://w', unknown.fetchFn), /renders an unknown theme: neon/);
});
