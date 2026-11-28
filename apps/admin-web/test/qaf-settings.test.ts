import assert from 'node:assert/strict';
import { test } from 'node:test';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { QAF_ERROR_MESSAGES, type QafSettings } from '@al-ummah/shared-types';
import { localizedQafError } from '../src/app/(protected)/errors/ui';
import { QafSetting } from '../src/app/(protected)/platform-settings/QafSetting';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { createTranslator } from '../src/i18n/translate';

(globalThis as unknown as { React: unknown }).React = React;

const initial: QafSettings = {
  connected: true, weeklyRemaining: 2499, weeklyResetAt: null, blocked: null,
  userMinute: 6, globalMinute: 30, userWeek: 25, globalWeek: 2500,
};

function card(locale: 'en' | 'ar') {
  const Provider = I18nProvider as unknown as React.FC<{ locale: 'en' | 'ar'; theme: 'dark'; children?: React.ReactNode }>;
  const setting = React.createElement(QafSetting, { initial, save: async () => ({ ok: true as const, data: initial }) });
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'dark' }, setting));
}

test('Qaf settings group the English quota and use ungrouped Arabic digits and قاف', () => {
  assert.match(card('en'), />2,499<\/dd>/);
  const arabic = card('ar');
  assert.match(arabic, />٢٤٩٩<\/dd>/);
  assert.match(arabic, /قاف/);
  assert.doesNotMatch(arabic, /\bQaf\b|٬/);
});

test('Errors displays Arabic Qaf titles and reasons for recorded integration failures', () => {
  const ar = createTranslator('ar');
  for (const report of Object.values(QAF_ERROR_MESSAGES)) {
    const localized = localizedQafError(ar, report);
    assert.match(localized, /قاف/);
    assert.doesNotMatch(localized, /\bQaf\b/);
  }
  assert.equal(localizedQafError(ar, 'An unrelated error'), 'An unrelated error');
});
