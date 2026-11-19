import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { campaignOf, deviceClassOf, originOf, parseClientHeader, scrubOrigin, sourceOf, surfaceOf } from '@al-ummah/shared-types';

const UA = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 18_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.1 Mobile/15E148 Safari/604.1',
  androidTablet: 'Mozilla/5.0 (Linux; Android 14; SM-X710) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36',
  tv: 'Mozilla/5.0 (SMART-TV; Linux; Tizen 7.0) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/4.0 TV Safari/537.36',
  google: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
  curl: 'curl/8.4.0',
};

describe('request origin: client', () => {
  it('reads X-AUN-Client', () => {
    assert.deepEqual(parseClientHeader('aun-ios/1.4.0 (iOS 18.1)'), { app: 'aun-ios', version: '1.4.0', os: 'ios', osVersion: '18.1' });
    assert.deepEqual(parseClientHeader('aun-tv/2.0 (AndroidTV 14)'), { app: 'aun-tv', version: '2.0', os: 'androidtv', osVersion: '14' });
    assert.equal(parseClientHeader('<script>'), null);
    assert.equal(parseClientHeader(null), null);
  });

  it('classifies every surface', () => {
    const native = (os: string) => surfaceOf({ client: parseClientHeader(`aun/1 (${os} 1)`) });
    assert.equal(native('iOS'), 'ios');
    assert.equal(native('iPadOS'), 'ipados');
    assert.equal(native('macOS'), 'macos');
    assert.equal(native('tvOS'), 'apple_tv');
    assert.equal(native('Android'), 'android');
    assert.equal(native('AndroidTV'), 'android_tv');
    assert.equal(native('Windows'), 'windows');
    assert.equal(native('Linux'), 'linux');
    assert.equal(native('Tizen'), 'tizen');
    assert.equal(surfaceOf({ userAgent: UA.google, app: 'web' }), 'bot');
    assert.equal(surfaceOf({ userAgent: UA.iphone, app: 'web', embed: true }), 'embed');
    assert.equal(surfaceOf({ userAgent: UA.mac, app: 'admin' }), 'admin');
    assert.equal(surfaceOf({ userAgent: UA.mac, app: 'api' }), 'web');
    assert.equal(surfaceOf({ userAgent: UA.curl, app: 'api' }), 'bot');
    assert.equal(surfaceOf({ userAgent: 'aun-script', app: 'api' }), 'api');
    assert.equal(surfaceOf({ app: 'api', m2m: true }), 'api');
  });

  it('classifies devices from client hints and the UA family', () => {
    assert.equal(deviceClassOf({ surface: 'web', userAgent: UA.iphone }), 'phone');
    assert.equal(deviceClassOf({ surface: 'web', userAgent: UA.ipad }), 'tablet');
    assert.equal(deviceClassOf({ surface: 'web', userAgent: UA.androidTablet }), 'tablet');
    assert.equal(deviceClassOf({ surface: 'web', userAgent: UA.mac }), 'desktop');
    assert.equal(deviceClassOf({ surface: 'web', userAgent: UA.tv }), 'tv');
    assert.equal(deviceClassOf({ surface: 'web', chMobile: '?1' }), 'phone');
    assert.equal(deviceClassOf({ surface: 'apple_tv' }), 'tv');
    assert.equal(deviceClassOf({ surface: 'bot', userAgent: UA.google }), 'unknown');
  });
});

describe('request origin: source', () => {
  const at = (q = '') => new URL(`https://alummahnow.net/en/video/abc${q}`);
  it('classifies referrers by host only', () => {
    assert.deepEqual(sourceOf({ url: at() }), { source: 'direct' });
    assert.deepEqual(sourceOf({ referrer: 'https://www.google.com/search?q=secret', url: at() }), { source: 'search:google', referrerHost: 'www.google.com' });
    assert.deepEqual(sourceOf({ referrer: 'https://t.co/abc', url: at() }), { source: 'social:x', referrerHost: 't.co' });
    assert.deepEqual(sourceOf({ referrer: 'https://www.alummahnow.net/scholars', url: at() }), { source: 'platform', referrerHost: 'www.alummahnow.net' });
    assert.deepEqual(sourceOf({ referrer: 'https://alummahnow.link/v/abc', url: at() }), { source: 'short_link' });
    assert.deepEqual(sourceOf({ referrer: 'https://blog.example.org/post/1?token=x', url: at() }), { source: 'site', referrerHost: 'blog.example.org' });
  });

  it('UTM source only, email and push, embeds', () => {
    assert.deepEqual(sourceOf({ url: at('?utm_source=Ramadan Newsletter&utm_campaign=secret&utm_content=x') }), { source: 'campaign', campaign: 'ramadan-newsletter' });
    assert.deepEqual(sourceOf({ url: at('?utm_medium=email&utm_source=weekly') }), { source: 'email', campaign: 'weekly' });
    assert.deepEqual(sourceOf({ referrer: 'https://mail.google.com/', url: at() }), { source: 'email' });
    assert.deepEqual(sourceOf({ url: at('?src=push') }), { source: 'push' });
    assert.deepEqual(sourceOf({ embed: true, embedHost: 'masjid.example.com', url: at() }), { source: 'embed', referrerHost: 'masjid.example.com' });
    assert.equal(campaignOf('  ../../etc  '), 'etc');
  });
});

describe('request origin: originOf + scrub', () => {
  it('keeps no IP, UA, query or path, and reads cf.country', () => {
    const req = new Request('https://videos.api.alummahnow.net/api/videos/abc?token=secret', {
      headers: { 'user-agent': UA.iphone, referer: 'https://www.google.com/search?q=x', 'cf-connecting-ip': '203.0.113.9', 'x-aun-client': 'aun-ios/1.4.0 (iOS 18.1)' },
    });
    Object.defineProperty(req, 'cf', { value: { country: 'EG' } });
    const o = originOf(req, { app: 'api', release: 'v2026.11.18.2', entry: '/api/videos/:id' });
    assert.deepEqual(o, { surface: 'ios', app: 'aun-ios', appVersion: '1.4.0', release: 'v2026.11.18.2', source: 'search:google', referrerHost: 'www.google.com', entry: '/api/videos/:id', country: 'EG', device: 'phone' });
    const text = JSON.stringify(o);
    for (const leak of ['203.0.113', 'Mozilla', 'secret', 'q=x']) assert.ok(!text.includes(leak), leak);
  });

  it('scrubOrigin drops anything outside the model', () => {
    assert.equal(scrubOrigin({ surface: 'toaster', source: 'direct' }), undefined);
    assert.deepEqual(scrubOrigin({ surface: 'web', source: 'direct', device: 'phone', email: 'a@b.co', ip: '1.2.3.4', country: 'eg', entry: '/x?y=1' }), { surface: 'web', source: 'direct', device: 'phone' });
  });
});
