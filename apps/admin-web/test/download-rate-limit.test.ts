/**
 * Admin Platform Settings: Download rate limit card (E14-D2).
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { DownloadRateLimitSetting } from '../src/app/(protected)/platform-settings/DownloadRateLimitSetting';

(globalThis as unknown as { React: unknown }).React = React;

function render(node: React.ReactElement, locale: 'en' | 'ar' = 'en') {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, node) as never);
}

describe('DownloadRateLimitSetting (E14-D2)', () => {
  const settings = {
    perDay: 100,
    burstPerMinute: 10,
    updatedAt: null,
    updatedBy: null,
  };
  const noopSave = async () => ({ ok: true as const, data: settings });

  it('renders editable per-day and burst inputs in English and Arabic with Eastern Arabic numerals', () => {
    const htmlEn = render(
      React.createElement(DownloadRateLimitSetting as unknown as React.FC<Record<string, unknown>>, {
        settings,
        history: [],
        canEdit: true,
        save: noopSave,
      }),
      'en',
    );
    assert.match(htmlEn, /data-testid="download-rate-limit-setting"/);
    assert.match(htmlEn, /data-testid="download-rate-limit-per-day"/);
    assert.match(htmlEn, /data-testid="download-rate-limit-burst"/);
    assert.match(htmlEn, /value="100"/);
    assert.match(htmlEn, /value="10"/);
    assert.match(htmlEn, /Download rate limit/);
    assert.match(htmlEn, /data-testid="download-rate-limit-save"/);

    const htmlAr = render(
      React.createElement(DownloadRateLimitSetting as unknown as React.FC<Record<string, unknown>>, {
        settings,
        history: [],
        canEdit: true,
        save: noopSave,
      }),
      'ar',
    );
    assert.match(htmlAr, /حدّ طلبات التنزيل/);
    assert.match(htmlAr, /value="١٠٠"/);
    assert.match(htmlAr, /value="١٠"/);
    assert.match(htmlAr, /١٠٠٠٠/);
  });

  it('renders read-only notice for non-admin roles and formats audit history entries', () => {
    const history = [
      {
        id: 'h1',
        oldValue: JSON.stringify({ perDay: 100, burstPerMinute: 10 }),
        newValue: JSON.stringify({ perDay: 250, burstPerMinute: 20 }),
        actorId: 'admin-1',
        createdAt: '2026-11-23T12:00:00.000Z',
      },
    ];
    const html = render(
      React.createElement(DownloadRateLimitSetting as unknown as React.FC<Record<string, unknown>>, {
        settings,
        history,
        canEdit: false,
        save: noopSave,
      }),
      'en',
    );
    assert.match(html, /data-testid="download-rate-limit-read-only"/);
    assert.doesNotMatch(html, /data-testid="download-rate-limit-save"/);
    assert.match(html, /100\/day, 10\/min/);
    assert.match(html, /250\/day, 20\/min/);
  });
});
