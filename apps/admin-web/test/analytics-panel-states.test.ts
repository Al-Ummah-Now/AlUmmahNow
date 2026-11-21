/**
 * Web vitals and Abuse panels (FIX-VITALS): a refused Analytics Engine read is never shown as "not
 * set up". admin-api's `code` picks the state (not_configured / unavailable with a reason and the
 * Errors page reference / failed), the states render in en and ar, and the Arabic copy keeps the
 * number rule (no grouping, Arabic digits).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createTranslator, type MessageKey } from '../src/i18n/translate';
import { AdminApiError } from '../src/lib/api/errors';
import { ANALYTICS_REASONS, analyticsLoadProblem } from '../src/lib/api/analytics-state';
import { PanelState } from '../src/components/PanelState';

// The components use the automatic JSX runtime under Next; tsx compiles them to React.createElement
(globalThis as { React?: unknown }).React = React;

describe('analyticsLoadProblem', () => {
  it('maps admin-api codes to the panel state', () => {
    assert.deepEqual(analyticsLoadProblem(new AdminApiError('x', 503, 'not_configured')), { kind: 'not_configured' });
    assert.deepEqual(
      analyticsLoadProblem(new AdminApiError('x', 503, 'unavailable', undefined, undefined, { reason: 'auth', ref: 'ERR-AB12-CD34' })),
      { kind: 'unavailable', reason: 'auth', ref: 'ERR-AB12-CD34' },
    );
    assert.deepEqual(analyticsLoadProblem(new AdminApiError('x', 503, 'unavailable', undefined, undefined, { reason: 'weird' })), { kind: 'unavailable', reason: 'unknown' });
    assert.deepEqual(analyticsLoadProblem(new AdminApiError('x', 503, 'unavailable')), { kind: 'unavailable', reason: 'unknown' });
    // A 503 without a code (admin-api unreachable) is a load failure, never "not set up"
    assert.deepEqual(analyticsLoadProblem(new AdminApiError('Admin API unreachable', 503)), { kind: 'failed' });
    assert.deepEqual(analyticsLoadProblem(new AdminApiError('boom', 500)), { kind: 'failed' });
    assert.deepEqual(analyticsLoadProblem(new Error('boom')), { kind: 'failed' });
  });
});

describe('panel state copy', () => {
  const keys: MessageKey[] = [
    'analyticsPanel.retry',
    'analyticsPanel.reference',
    'analyticsPanel.openErrors',
    'analyticsPanel.flagged',
    ...[...ANALYTICS_REASONS, 'unknown'].map((r) => `analyticsPanel.reasons.${r}` as MessageKey),
    'vitalsPage.notConfiguredTitle',
    'vitalsPage.unavailableTitle',
    'vitalsPage.emptyTitle1',
    'vitalsPage.emptyTitle7',
    'vitalsPage.emptyTitle28',
    'vitalsPage.emptyBody',
    'vitalsPage.emptyNonProduction',
    'vitalsPage.emptyLonger',
    'vitalsPage.emptyAllLanguages',
    'vitalsPage.emptyProduction',
    'abusePage.notConfiguredTitle',
    'abusePage.unavailableTitle',
  ];

  it('exists in en and ar, and Arabic numbers are Arabic digits, never grouped', () => {
    const tEn = createTranslator('en');
    const tAr = createTranslator('ar');
    for (const key of keys) {
      assert.notEqual(tEn(key), key, `en ${key}`);
      // The translator falls back to English: a missing Arabic string would come back in English
      assert.notEqual(tAr(key), tEn(key), `ar ${key}`);
      assert.doesNotMatch(tAr(key), /[0-9]|٬/, `ar ${key} has Western digits or a group separator`);
    }
    assert.equal(tAr('vitalsPage.emptyTitle28'), 'لم يُقَس أي تحميل للصفحات بعد في آخر ٢٨ يومًا');
    assert.equal(tEn('vitalsPage.emptyTitle7'), 'No page loads measured yet in the last 7 days');
    // The auth reason names the exact permission the token lacks
    for (const t of [tEn, tAr]) assert.match(t('analyticsPanel.reasons.auth'), /Account → Account Analytics → Read/);
  });

  it('renders the unavailable state with the reason, Try again and the Errors page link', () => {
    const t = createTranslator('ar');
    const html = renderToStaticMarkup(
      React.createElement(PanelState, {
        tone: 'problem',
        testId: 'vitals-unavailable',
        reason: 'auth',
        title: t('vitalsPage.unavailableTitle'),
        body: t('analyticsPanel.reasons.auth'),
        note: t('analyticsPanel.flagged'),
        action: { label: t('analyticsPanel.retry'), href: '/web-vitals?env=production&days=7&locale=all' },
        reference: { label: t('analyticsPanel.reference'), ref: 'ERR-AB12-CD34', linkLabel: t('analyticsPanel.openErrors') },
      }),
    );
    assert.match(html, /role="alert"/);
    assert.match(html, /data-reason="auth"/);
    assert.match(html, /href="\/web-vitals\?env=production&amp;days=7&amp;locale=all"/);
    assert.match(html, /href="\/errors\?q=ERR-AB12-CD34"/);
    assert.match(html, /<code dir="ltr"[^>]*>ERR-AB12-CD34<\/code>/);
    assert.doesNotMatch(html, /غير مُعدّة/);
    assert.doesNotMatch(html, / · /);
  });

  it('renders the empty state as a status, not an alert', () => {
    const t = createTranslator('en');
    const html = renderToStaticMarkup(
      React.createElement(PanelState, { tone: 'empty', testId: 'vitals-empty-state', title: t('vitalsPage.emptyTitle7'), body: t('vitalsPage.emptyBody'), action: { label: t('vitalsPage.emptyLonger'), href: '/web-vitals?days=28' } }),
    );
    assert.match(html, /role="status"/);
    assert.match(html, /No page loads measured yet in the last 7 days/);
    assert.doesNotMatch(html, /not set up/);
  });
});
