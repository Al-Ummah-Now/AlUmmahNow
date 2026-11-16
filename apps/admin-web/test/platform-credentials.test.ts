/**
 * Platform settings → Credentials (Super Admin): the editor's rules (state, token check, plain-words
 * copy for each missing Cloudflare permission, friendly errors) and the rendered section in en and
 * ar. Never a value: Replace opens an empty password field, and the page shows only the last four.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { CLOUDFLARE_MEDIA_CHECKS, type PlatformCredentialView } from '@al-ummah/shared-types';
import { CHECK_COPY, credentialState, saveErrorKey, testSummary, tokenError } from '../src/lib/platform-credentials';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { PlatformCredentialsSetting } from '../src/app/(protected)/platform-settings/PlatformCredentialsSetting';
import { createTranslator } from '../src/i18n/translate';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

const TOKEN = 'Abcdefghijklmnopqrstuvwxyz0123456789-_QZ';
const AT = '2026-11-16T10:00:00.000Z';
const view = (over: Partial<PlatformCredentialView> = {}): PlatformCredentialView => ({
  id: 'cloudflare-media',
  secretsStoreName: 'media-cdn-api-token',
  usedBy: [
    { worker: 'api-videos', binding: 'MEDIA_CDN_API_TOKEN' },
    { worker: 'api-videos', binding: 'MEDIA_ANALYTICS_TOKEN' },
    { worker: 'admin-api', binding: 'CF_ANALYTICS_TOKEN' },
  ],
  source: 'binding',
  present: true,
  last4: null,
  updatedAt: null,
  updatedBy: null,
  updatedByName: null,
  unreadable: false,
  test: null,
  ...over,
});
const allOk = { ok: true, code: 'ok', checks: CLOUDFLARE_MEDIA_CHECKS.map((name) => ({ name, ok: true })), at: AT, by: 'super-1' };
const missing = { ok: false, code: 'missing_permissions', checks: CLOUDFLARE_MEDIA_CHECKS.map((name) => ({ name, ok: name === 'token' || name === 'account_analytics' })), at: AT, by: 'super-1' };

const stub = async () => ({ ok: true as const, data: { view: view(), test: allOk } });

function render(views: PlatformCredentialView[], locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, React.createElement(PlatformCredentialsSetting as unknown as React.FC<{ views: PlatformCredentialView[]; replace: typeof stub; test: typeof stub }>, { views, replace: stub, test: stub })) as never);
}

describe('credentials: editor rules', () => {
  it('says whether the token is missing, untested, working or needs attention', () => {
    assert.equal(credentialState(view({ present: false, source: null })), 'missing');
    assert.equal(credentialState(view()), 'untested');
    assert.equal(credentialState(view({ test: allOk })), 'ok');
    assert.equal(credentialState(view({ test: missing })), 'attention');
    assert.equal(credentialState(view({ unreadable: true, test: allOk })), 'attention');
  });

  it('checks the token before sending it', () => {
    assert.equal(tokenError(''), 'platformCredentials.errorEmpty');
    assert.equal(tokenError('not a token'), 'platformCredentials.errorToken');
    assert.equal(tokenError(TOKEN), null);
    assert.equal(saveErrorKey(403), 'platformCredentials.errorForbidden');
    assert.equal(saveErrorKey(503), 'platformCredentials.errorUnavailable');
    assert.equal(saveErrorKey(500, 'boom'), 'platformCredentials.errorFailed');
    assert.equal(testSummary('missing_permissions'), 'platformCredentials.testMissing');
    assert.equal(testSummary('weird'), 'platformCredentials.testUnreachable');
  });

  it('names each permission in Cloudflare\'s own words and says what stops working', () => {
    const t = createTranslator('en');
    assert.match(t(CHECK_COPY.cache_purge.permission), /Zone → Cache Purge → Purge for alummahnow\.net/);
    assert.match(t(CHECK_COPY.zone_analytics.permission), /Zone → Analytics → Read/);
    assert.match(t(CHECK_COPY.account_analytics.permission), /Account → Account Analytics → Read/);
    assert.match(t(CHECK_COPY.cache_purge.impact), /private can stay cached/);
  });

  it('has every string in English and Arabic, with «مرئي» and Arabic digits', () => {
    const enKeys = Object.keys(en.platformCredentials).sort();
    assert.deepEqual(Object.keys(ar.platformCredentials).sort(), enKeys);
    for (const key of enKeys) assert.match((ar.platformCredentials as Record<string, string>)[key]!, /[؀-ۿ]/, key);
    // Product names (R2) keep their digit; every number in the copy is in Arabic digits
    assert.doesNotMatch(JSON.stringify(ar.platformCredentials).replace(/R2|\{\w+\}/g, ''), /فيديو|[0-9]/);
  });
});

describe('credentials: the section', () => {
  it('shows the Secrets Store source with Replace and Test, and no value anywhere', () => {
    const html = render([view()]);
    assert.match(html, /data-testid="credential-cloudflare-media"[^>]*data-state="untested"/);
    assert.match(html, /From the Cloudflare Secrets Store entry/);
    assert.match(html, /media-cdn-api-token/);
    assert.match(html, /data-testid="credential-cloudflare-media-replace"/);
    assert.match(html, /data-testid="credential-cloudflare-media-run-test"/);
    assert.match(html, /Not tested yet/);
    assert.doesNotMatch(html, /type="password"/, 'the field only opens on Replace');
  });

  it('shows a token set here with its last four, and each missing permission in plain words', () => {
    const html = render([view({ source: 'admin', last4: 'Q_ZZ', updatedAt: AT, updatedBy: 'super-1', updatedByName: 'Mahmoud', test: missing })]);
    assert.match(html, /Set here on .* by Mahmoud\. Ends in …Q_ZZ\./);
    assert.match(html, /data-state="attention"/);
    assert.match(html, /The token works, but some permissions are missing/);
    assert.match(html, /data-testid="credential-check-cache_purge" data-ok="false"/);
    assert.match(html, /Add Zone → Cache Purge → Purge for alummahnow\.net\./);
    assert.match(html, /data-testid="credential-check-account_analytics" data-ok="true"/);
    assert.doesNotMatch(html, /Add Account → Account Analytics/, 'a passed check gives no advice');
  });

  it('a missing token offers Add and cannot be tested; an unreadable one asks to set it again', () => {
    const missingHtml = render([view({ present: false, source: null })]);
    assert.match(missingHtml, />Add token</);
    assert.match(missingHtml, /data-testid="credential-cloudflare-media-run-test"[^>]*disabled|disabled[^>]*data-testid="credential-cloudflare-media-run-test"/);
    assert.match(render([view({ unreadable: true })]), /can no longer be read/);
  });

  it('renders right to left in Arabic', () => {
    const html = render([view({ test: allOk })], 'ar');
    assert.match(html, /رمز Cloudflare للوسائط/);
    assert.match(html, /كل الصلاحيات التي تحتاجها خدماتنا موجودة/);
  });
});
