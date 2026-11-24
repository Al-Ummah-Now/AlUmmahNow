/** Age rules page (E20-B2): the checks say what is missing, the form shows and describes the ages, en and ar. */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { AgeRulesChecks } from '../src/components/age-rules/AgeRulesChecks';
import { AgeRulesForm } from '../src/components/age-rules/AgeRulesForm';

(globalThis as unknown as { React: unknown }).React = React;

function render(node: React.ReactElement, locale: 'en' | 'ar' = 'en') {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, node) as never);
}
const NUMBERS = { comment: 13, post: 13, liveChat: 16, upload: 13, support: 18, ageRestricted: 18 } as const;
const checks = (ok: boolean) =>
  (['birthDate', 'numbers', 'accountEvents'] as const).map((key) => ({ key, ok, reasonKey: key, reason: { en: `Why ${key}`, ar: `سبب ${key === 'numbers' ? 'الأعمار' : 'آخر'}` } }));
const view = (over: object = {}) => ({ numbers: null, suggested: NUMBERS, version: 0, updatedAt: null, updatedBy: null, switchOn: false, checks: checks(false), canEdit: true, ...over });
const form = (v: object, history: unknown = []) => React.createElement(AgeRulesForm as unknown as React.FC<Record<string, unknown>>, { view: v, history, save: async () => ({ ok: true }) });

describe('checks', () => {
  it('a failing check says why; a passing one doesn’t; the state is in words too', () => {
    const off = render(React.createElement(AgeRulesChecks, { checks: checks(false), switchOn: false } as never));
    assert.match(off, /data-ready="false"/);
    assert.match(off, /can’t be turned on yet/);
    assert.match(off, /Why birthDate/);
    assert.match(off, /not ready/);
    const ready = render(React.createElement(AgeRulesChecks, { checks: checks(true), switchOn: false } as never));
    assert.match(ready, /data-ready="true"/);
    assert.ok(!ready.includes('Why birthDate'));
    assert.match(render(React.createElement(AgeRulesChecks, { checks: checks(false), switchOn: true } as never), 'ar'), /المفتاح مشغّل/);
  });
});

describe('form', () => {
  it('unsaved: the suggested ages, savable, and it says they are suggestions', () => {
    const html = render(form(view()));
    for (const key of Object.keys(NUMBERS)) assert.match(html, new RegExp(`data-testid="age-rules-${key}"`));
    assert.match(html, /16 and over/);
    assert.match(html, /suggestions until you save/);
    assert.match(html, /data-testid="age-rules-save"/);
    assert.ok(!/<button[^>]*disabled=""[^>]*data-testid="age-rules-save"/.test(html));
  });

  it('saved and unchanged: nothing to save', () => {
    const html = render(form(view({ numbers: NUMBERS, version: 1, updatedAt: '2026-11-24T10:00:00Z', updatedBy: { id: 'usr_a', name: 'Yusuf' } })));
    assert.match(html, /<button[^>]*disabled=""[^>]*data-testid="age-rules-save"|data-testid="age-rules-save"[^>]*disabled=""/);
  });

  it('read-only for anyone else', () => {
    const html = render(form(view({ canEdit: false })));
    assert.match(html, /Only super admins/);
    assert.ok(!html.includes('data-testid="age-rules-save"'));
  });

  it('history names only what changed; a failed load is not an empty history', () => {
    const entry = { id: '1', from: NUMBERS, to: { ...NUMBERS, liveChat: 18 }, actorId: 'usr_a', actorName: 'Yusuf', createdAt: '2026-11-24T10:00:00Z' };
    const html = render(form(view({ numbers: entry.to, version: 2 }), [entry]));
    assert.match(html, /Live chat: 16 and over → 18 and over/);
    assert.ok(!html.includes('Comment and reply: '));
    assert.match(render(form(view(), null)), /data-testid="age-rules-history-error"/);
    assert.match(render(form(view(), [])), /No changes yet/);
  });

  it('Arabic uses Arabic digits and arrows', () => {
    const entry = { id: '1', from: NUMBERS, to: { ...NUMBERS, liveChat: 18 }, actorId: 'usr_a', actorName: 'يوسف', createdAt: '2026-11-24T10:00:00Z' };
    const html = render(form(view({ numbers: entry.to, version: 2 }), [entry]), 'ar');
    assert.match(html, /١٦ فأكثر ← ١٨ فأكثر/);
    assert.ok(!/>[^<]*\b(13|16|18)\b[^<]*</.test(html));
  });
});
