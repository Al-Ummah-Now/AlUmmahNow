/**
 * Admin setting help (wiki AUN-ADMIN-HELP): the "?" renders as an accessible closed button with its
 * brief text ready, in English and Arabic (٠–٩); the guide's search folds Arabic letter forms; the
 * guide is in the nav for every admin role, reviewers too.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;
import { I18nProvider } from '../src/i18n/I18nProvider';
import { HelpTips } from '../src/components/help/HelpTips';
import { HelpTip } from '../src/components/help/HelpTip';
import { fold, matchHelp } from '../src/lib/help/search';
import { helpArea, helpAreas, tipsFor } from '../src/lib/help/content';
import { NAV_ITEMS, visibleItems } from '../src/components/shell/nav-model';
import { hrefFor } from '../src/components/search/autocomplete-model';

function render(locale: 'en' | 'ar', id: string): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  const tree = React.createElement(Provider, { locale, theme: 'dark' }, React.createElement(HelpTips as unknown as React.FC<{ tips: unknown; children?: React.ReactNode }>, { tips: tipsFor(locale, 'platform-settings') }, React.createElement(HelpTip, { id })));
  return renderToStaticMarkup(tree as never);
}

describe('HelpTip', () => {
  it('renders a closed, labeled button and a hidden dialog with Learn more inside', () => {
    const html = render('en', 'platform.downloads.perDay');
    assert.match(html, /role="button"/);
    assert.match(html, /tabindex="0"/);
    assert.match(html, /aria-expanded="false"/);
    assert.match(html, /aria-label="Help: Max download requests per day"/);
    assert.match(html, /role="dialog"[^>]*hidden=""/);
    assert.match(html, /href="\/help\/platform-settings#downloads-per-day"/);
    assert.match(html, /Learn more in the admin guide/);
    assert.ok(!/title="/.test(html), 'never the browser title tooltip');
  });

  it('shows the one-line caution only when the entry has one', () => {
    assert.match(render('en', 'platform.downloads.perDay'), /help-tip-caution/);
    assert.ok(!render('en', 'platform.downloads.burstPerMinute').includes('help-tip-caution'));
  });

  it('is Arabic in Arabic', () => {
    const html = render('ar', 'platform.downloads.perDay');
    assert.match(html, /aria-label="مساعدة: أقصى عدد لطلبات التنزيل يوميًا"/);
    assert.match(html, /المزيد في دليل الإدارة/);
  });

  it('renders nothing for an id the page did not load', () => {
    assert.equal(render('en', 'nope.not.here'), '');
  });
});

describe('help content in the admin', () => {
  it('Arabic guide text has no 0–9 outside Latin names and links', () => {
    for (const area of helpAreas('ar')) {
      for (const s of area.settings) {
        for (const text of [s.label, s.summary, s.what, s.changes, s.default ?? '', s.range ?? '', ...s.cautions, ...s.rules.map((r) => r.text)]) {
          const bare = text.replace(/[A-Za-z][A-Za-z0-9._-]*/g, '');
          assert.ok(!/[0-9]/.test(bare), `${s.id}: ${text}`);
        }
      }
    }
    assert.equal(helpArea('ar', 'platform-settings')?.settings.find((s) => s.id === 'platform.downloads.perDay')?.default, '١٠٠ طلب يوميًا');
  });

  it('the guide search folds Arabic letter forms and ranks label matches first', () => {
    assert.equal(fold('إعداد'), fold('اعداد'));
    const items = helpAreas('ar').flatMap((a) => a.settings.map((s) => ({ href: s.href, label: s.label, area: a.title, summary: s.summary })));
    assert.equal(matchHelp(items, 'التنزيل')[0]?.href.startsWith('/help/platform-settings#downloads'), true);
    const en = helpAreas('en').flatMap((a) => a.settings.map((s) => ({ href: s.href, label: s.label, area: a.title, summary: s.summary })));
    assert.equal(matchHelp(en, 'client secret')[0]?.href, '/help/platform-settings#youtube-import-client-secret');
    assert.deepEqual(matchHelp(en, 'zzzz'), []);
  });

  it('a help suggestion opens its guide section', () => {
    assert.equal(hrefFor({ kind: 'help', id: '/help/platform-settings#downloads-per-day' }), '/help/platform-settings#downloads-per-day');
  });

  it('the guide is in the nav for every admin role (not in the review-only shell)', () => {
    assert.ok(NAV_ITEMS.some((i) => i.href === '/help'));
    assert.ok(visibleItems({ contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false }).some((i) => i.href === '/help'));
    assert.ok(!visibleItems({ contact: false, processing: false, errors: false, manageUsers: false, staleUploads: false, media: false, ops: false, reviewOnly: true }).some((i) => i.href === '/help'));
  });
});
