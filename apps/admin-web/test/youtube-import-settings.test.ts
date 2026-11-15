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
import { clientIdError, formOf, readiness, saveErrorMessage, scopePurpose, secretNameFor, settingsPatch } from '../src/lib/youtube-import';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { YoutubeImportSetting } from '../src/app/(protected)/platform-settings/YoutubeImportSetting';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

/** The save server action, stubbed: render tests never save. */
const save = async () => ({ ok: true as const, data: view() });
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

  it('has every string in English and Arabic', () => {
    const enKeys = Object.keys(en.youtubeImport).sort();
    assert.deepEqual(Object.keys(ar.youtubeImport).sort(), enKeys);
    for (const key of enKeys) assert.match((ar.youtubeImport as Record<string, string>)[key]!, /[؀-ۿ]|myaccount|Google|Credentials/, key);
    assert.doesNotMatch(JSON.stringify(ar.youtubeImport), /فيديو/);
  });
});

describe('YouTube import settings: the section', () => {
  it('shows a missing secret with its name, the redirect URI and the scopes', () => {
    const html = render(el(YoutubeImportSetting, { view: view({ clientId: CLIENT }), canEdit: true, save }));
    assert.match(html, /data-state="needsSecret"/);
    assert.match(html, /data-present="false"/);
    assert.match(html, /google-oauth-client-secret-qa/);
    assert.match(html, /https:\/\/videos\.api\.qa\.alummahnow\.net\/api\/youtube-import\/oauth\/callback/);
    assert.match(html, /youtube\.readonly/);
    assert.match(html, /youtube\.force-ssl/);
    assert.match(html, /data-testid="youtube-import-save"[^>]*disabled|disabled[^>]*data-testid="youtube-import-save"/, 'nothing to save yet');
  });

  it('shows ready, read-only for a role that cannot edit, and in Arabic', () => {
    const ready = view({ clientId: CLIENT, secretPresent: true, enabled: true, ready: true, updatedAt: '2026-11-14T10:00:00.000Z', updatedBy: 'usr_admin' });
    const html = render(el(YoutubeImportSetting, { view: ready, canEdit: false, save }));
    assert.match(html, /data-state="ready"/);
    assert.match(html, /Creators can connect/);
    assert.match(html, /data-testid="youtube-import-read-only"/);
    assert.match(html, /usr_admin/);
    const arabic = render(el(YoutubeImportSetting, { view: ready, canEdit: true, save }), 'ar');
    assert.match(arabic, /النقل من يوتيوب/);
    assert.match(arabic, /يمكن لصنّاع المحتوى الربط/);
  });
});
