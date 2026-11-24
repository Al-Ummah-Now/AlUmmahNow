/**
 * Platform settings → YouTube import (wiki AUN-YT-IMPORT): the form rules
 * (client id, what a save sends, readiness, the environment's secret name,
 * friendly errors) and the rendered section in en and ar (never a secret value).
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { YT_SCOPE_CAPTIONS, YT_SCOPE_READONLY, type YoutubeImportSettingsView } from '@al-ummah/shared-types';
import { clientIdError, clientSecretError, formOf, readiness, switchOf, saveErrorMessage, scopePurpose, secretChecksOnBlur, secretNameFor, urlSegments, secretSaveErrorMessage, settingsPatch } from '../src/lib/youtube-import';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { YoutubeImportSetting } from '../src/app/(protected)/platform-settings/YoutubeImportSetting';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

/** The save server action, stubbed: render tests never save. */
const save = async () => ({ ok: true as const, data: view() });
const saveSecret = async () => ({ ok: true as const, data: view() });
const CLIENT = '123456789012-abcdefgh12345678.apps.googleusercontent.com';
const view = (over: Partial<YoutubeImportSettingsView> = {}): YoutubeImportSettingsView => ({
  enabled: false,
  clientId: '',
  updatedAt: null,
  updatedBy: null,
  secretPresent: false,
  redirectUri: 'https://videos.api.qa.alummahnow.net/api/youtube-import/oauth/callback',
  scopes: [YT_SCOPE_READONLY, YT_SCOPE_CAPTIONS],
  ready: false,
  ...over,
});

function el<P extends object>(component: (props: P) => unknown, props: P): React.ReactElement {
  return React.createElement(component as unknown as React.FC<P>, props);
}

function render(element: React.ReactElement, locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}

describe('YouTube import settings: form rules', () => {
  it('accepts a Google client id or an empty one, and needs one to turn on', () => {
    assert.equal(clientIdError({ enabled: false, clientId: '' }), null);
    assert.equal(clientIdError({ enabled: true, clientId: ` ${CLIENT} ` }), null);
    assert.equal(clientIdError({ enabled: false, clientId: 'not-a-client' }), 'youtubeImport.errorClientId');
    assert.equal(clientIdError({ enabled: true, clientId: '' }), 'youtubeImport.errorClientIdNeeded');
  });

  it('sends only what changed, trimmed', () => {
    const v = view({ clientId: CLIENT });
    assert.equal(settingsPatch(v, formOf(v)), null);
    assert.deepEqual(settingsPatch(v, { enabled: true, clientId: ` ${CLIENT}` }), { enabled: true });
    assert.deepEqual(settingsPatch(v, { enabled: false, clientId: '' }), { clientId: '' });
  });

  it('says why creators cannot connect yet', () => {
    assert.equal(readiness(view()), 'needsClientId');
    assert.equal(readiness(view({ clientId: CLIENT })), 'needsSecret');
    assert.equal(readiness(view({ clientId: CLIENT, secretPresent: true })), 'off');
    assert.equal(readiness(view({ clientId: CLIENT, secretPresent: true, enabled: true, ready: true })), 'ready');
  });

  it('the Features switch, not the old setting, decides the badge and whether the client id may be cleared', () => {
    assert.deepEqual(switchOf({ enabled: false }, { enabled: true, effective: false }), { stored: true, effective: false });
    assert.deepEqual(switchOf({ enabled: true }, null), { stored: true, effective: true }, 'no Features answer: the old value');
    const v = view({ clientId: CLIENT, secretPresent: true, enabled: true });
    assert.equal(readiness({ ...v, enabled: switchOf(v, { enabled: true, effective: false }).effective }), 'off', 'Uploads off: creators cannot connect');
    assert.equal(clientIdError({ enabled: switchOf(v, { enabled: true, effective: false }).stored, clientId: '' }), 'youtubeImport.errorClientIdNeeded');
  });

  it('names the Secrets Store secret of each environment', () => {
    assert.equal(secretNameFor('https://videos.api.qa.alummahnow.net/x'), 'google-oauth-client-secret-qa');
    assert.equal(secretNameFor('https://videos.api.stage.alummahnow.net/x'), 'google-oauth-client-secret-stage');
    assert.equal(secretNameFor('https://videos.api.alummahnow.net/x'), 'google-oauth-client-secret');
    assert.equal(secretNameFor('not a url'), 'google-oauth-client-secret');
  });

  it('explains each scope and maps failures to friendly messages', () => {
    assert.equal(scopePurpose(YT_SCOPE_READONLY), 'youtubeImport.scopeReadonly');
    assert.equal(scopePurpose(YT_SCOPE_CAPTIONS), 'youtubeImport.scopeCaptions');
    assert.equal(saveErrorMessage({ status: 401 }), 'errors.notAuthenticated');
    assert.equal(saveErrorMessage({ status: 403 }), 'youtubeImport.errorForbidden');
    assert.equal(saveErrorMessage({ status: 400 }), 'youtubeImport.errorClientId');
    assert.equal(saveErrorMessage({ status: 503 }), 'youtubeImport.saveFailed');
  });

  it('checks the client secret before sending it, and maps its failures', () => {
    assert.equal(clientSecretError(''), 'youtubeImport.errorSecretEmpty');
    assert.equal(clientSecretError('   '), 'youtubeImport.errorSecretEmpty');
    assert.equal(clientSecretError('short'), 'youtubeImport.errorSecret');
    assert.equal(clientSecretError('has spaces in the middle'), 'youtubeImport.errorSecret');
    assert.equal(clientSecretError('unset'), 'youtubeImport.errorSecret');
    assert.equal(clientSecretError(' test-only-abcdefghijklmnopqrstuvwx '), null);
    assert.equal(secretSaveErrorMessage({ status: 400 }), 'youtubeImport.errorSecret');
    assert.equal(secretSaveErrorMessage({ status: 403 }), 'youtubeImport.errorForbidden');
    assert.equal(secretSaveErrorMessage({ status: 502 }), 'youtubeImport.secretSaveFailed');
  });

  it('cuts a URL only after its slashes, and loses nothing', () => {
    const url = 'https://videos.api.alummahnow.net/api/youtube-import/oauth/callback';
    assert.deepEqual(urlSegments(url), ['https://', 'videos.api.alummahnow.net/', 'api/', 'youtube-import/', 'oauth/', 'callback']);
    assert.equal(urlSegments(url).join(''), url);
    assert.deepEqual(urlSegments('http://localhost:3086/'), ['http://', 'localhost:3086/']);
  });

  it('leaving an empty secret field says nothing (Cancel stays where the pointer is); a typed value is checked', () => {
    assert.equal(secretChecksOnBlur(''), false);
    assert.equal(secretChecksOnBlur('   '), false);
    assert.equal(secretChecksOnBlur('short'), true);
  });

  it('never tells the admin to paste the secret in Cloudflare', () => {
    for (const messages of [en, ar]) {
      const steps = Object.entries(messages.youtubeImport).filter(([k]) => k.startsWith('step')).map(([, v]) => v).join(' ');
      assert.doesNotMatch(steps, /Cloudflare|Secrets Store/);
    }
  });

  it('has every string in English and Arabic', () => {
    const enKeys = Object.keys(en.youtubeImport).sort();
    assert.deepEqual(Object.keys(ar.youtubeImport).sort(), enKeys);
    for (const key of enKeys) assert.match((ar.youtubeImport as Record<string, string>)[key]!, /[؀-ۿ]|myaccount|Google|Credentials/, key);
    assert.doesNotMatch(JSON.stringify(ar.youtubeImport), /فيديو/);
  });
});

describe('YouTube import settings: the section', () => {
  it('shows a missing secret with Add, the redirect URI and the scopes', () => {
    const html = render(el(YoutubeImportSetting, { view: view({ clientId: CLIENT }), canEdit: true, save, saveSecret }));
    assert.match(html, /data-state="needsSecret"/);
    assert.match(html, /data-present="false"/);
    assert.doesNotMatch(html, /google-oauth-client-secret/, 'a missing secret is set here, not in Cloudflare');
    // The URL is in pieces that wrap only after a "/" (<wbr>); its text is the whole URL
    assert.match(html.replace(/<[^>]+>/g, ''), /https:\/\/videos\.api\.qa\.alummahnow\.net\/api\/youtube-import\/oauth\/callback/);
    assert.match(html, /youtube-import\/<\/span><\/span><span><wbr\/><span class="whitespace-nowrap">oauth\//);
    assert.match(html, /youtube\.readonly/);
    assert.match(html, /youtube\.force-ssl/);
    // Missing: an "Add client secret" button, no field (and so no value) until it is pressed
    assert.match(html, /data-testid="youtube-import-secret-replace"[^>]*>Add client secret</);
    assert.doesNotMatch(html, /youtube-import-secret-input/);
    assert.match(html, /data-testid="youtube-import-save"[^>]*disabled|disabled[^>]*data-testid="youtube-import-save"/, 'nothing to save yet');
  });

  it('shows ready, read-only for a role that cannot edit, and in Arabic', () => {
    const ready = view({ clientId: CLIENT, secretPresent: true, enabled: true, ready: true, updatedAt: '2026-11-14T10:00:00.000Z', updatedBy: 'usr_admin' });
    const html = render(el(YoutubeImportSetting, { view: ready, canEdit: false, save, saveSecret }));
    assert.match(html, /data-state="ready"/);
    assert.match(html, /Creators can connect/);
    assert.match(html, /data-testid="youtube-import-read-only"/);
    // The name comes from UserName (resolved in the browser), not the id in the sentence
    assert.doesNotMatch(html, /by usr_admin/);
    assert.doesNotMatch(html, /youtube-import-secret-replace/, 'no Replace without the media permission');
    const arabic = render(el(YoutubeImportSetting, { view: ready, canEdit: true, save, saveSecret }), 'ar');
    assert.match(arabic, /النقل من يوتيوب/);
    assert.match(arabic, /يمكن لصنّاع المحتوى الربط/);
  });

  it('says where a present secret comes from, offers Replace, and never holds a value', () => {
    const setHere = view({ clientId: CLIENT, secretPresent: true, secretSource: 'admin', secretUpdatedAt: '2026-11-15T09:00:00.000Z', secretUpdatedBy: 'usr_admin' });
    const html = render(el(YoutubeImportSetting, { view: setHere, canEdit: true, save, saveSecret }));
    assert.match(html, /data-source="admin"/);
    assert.match(html, /data-testid="youtube-import-secret-state"[^>]*>Present</);
    // A person by name (resolved by UserName), never their raw id in the sentence
    assert.match(html, /Set here on .* by /);
    assert.doesNotMatch(html, /by usr_admin/);
    assert.match(html, /data-testid="youtube-import-secret-replace"[^>]*>Replace</);
    assert.doesNotMatch(html, /type="password"/);
    assert.doesNotMatch(html, /google-oauth-client-secret/, 'no Secrets Store name while the admin-set one is used');
    const fromStore = render(el(YoutubeImportSetting, { view: view({ clientId: CLIENT, secretPresent: true, secretSource: 'binding' }), canEdit: true, save, saveSecret }));
    assert.match(fromStore, /data-source="binding"/);
    assert.match(fromStore, /google-oauth-client-secret-qa/);
    const arabic = render(el(YoutubeImportSetting, { view: setHere, canEdit: true, save, saveSecret }), 'ar');
    assert.match(arabic, />موجود</);
    assert.match(arabic, />استبدال</);
  });

  it('asks to set the secret again when the stored one no longer opens', () => {
    const html = render(el(YoutubeImportSetting, { view: view({ clientId: CLIENT, secretPresent: false, secretSource: null, secretUnreadable: true }), canEdit: true, save, saveSecret }));
    assert.match(html, /data-testid="youtube-import-secret-unreadable"/);
    assert.match(html, /data-state="needsSecret"/);
  });
});
