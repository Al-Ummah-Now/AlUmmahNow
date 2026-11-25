import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { getSiteTheme, resetSiteThemeCache } from '../src/lib/site-theme';

const realFetch = globalThis.fetch;
const realNow = Date.now;
const pkg = { theme: 'eid-lights', package: { id: 'eid-lights', version: '1.0.0', css: 'https://admin.test/public/themes/eid-lights/1.0.0/theme.css' } };
const css = "html[data-theme='eid-lights']{--m-page:none}";
const fawanees = { id: 'fawanees', css: null };
let themeCss = css;

/** The answer of the setting; the package's CSS is `themeCss`. */
const answer = (body: unknown, status = 200) => {
  globalThis.fetch = (async (url: string) => (String(url).endsWith('.css') ? new Response(themeCss) : Response.json(body, { status }))) as typeof fetch;
};

beforeEach(() => {
  process.env.ADMIN_API_URL = 'https://admin.test';
  delete process.env.NEXT_PUBLIC_ACTIVE_THEME;
  themeCss = css;
  resetSiteThemeCache();
});
afterEach(() => {
  globalThis.fetch = realFetch;
  Date.now = realNow;
});

test('without a theme read before, a failed read renders the default', async () => {
  answer({}, 503);
  assert.deepEqual(await getSiteTheme(), fawanees);
});

test('a read that fails or is not a theme keeps the last one, for a day', async () => {
  answer(pkg);
  assert.deepEqual(await getSiteTheme(), { id: 'eid-lights', css });
  for (const [body, status] of [[{}, 503], [{}, 500], [null, 200], [{}, 200], [{ theme: 'eid-lights' }, 200], [{ theme: 'neon' }, 200]] as const) {
    answer(body, status);
    assert.deepEqual(await getSiteTheme(), { id: 'eid-lights', css }, JSON.stringify([body, status]));
  }
  answer(pkg);
  themeCss = '</style><script>';
  assert.deepEqual(await getSiteTheme(), { id: 'eid-lights', css }, 'unsafe CSS');
  globalThis.fetch = (async () => Promise.reject(new Error('down'))) as typeof fetch;
  assert.deepEqual(await getSiteTheme(), { id: 'eid-lights', css });
  Date.now = () => realNow() + 25 * 3_600_000;
  assert.deepEqual(await getSiteTheme(), fawanees);
});

test('an answer wins at once, the default included', async () => {
  answer(pkg);
  await getSiteTheme();
  answer({ theme: 'nahas' });
  assert.deepEqual(await getSiteTheme(), { id: 'nahas', css: null });
  answer({ theme: 'fawanees' });
  assert.deepEqual(await getSiteTheme(), fawanees);
});
