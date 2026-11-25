/**
 * Staff-set en/ar fields (L10N rule): the pure helpers (missing language, filters, batches), and
 * LocalizedFieldPair in a DOM (jsdom): labelled English | العربية inputs with dir/lang, Translate in
 * both directions with a mocked service, Undo when it replaced text, Quran refusal, errors tied to
 * the fields, and the "Translate missing" review that saves nothing unseen.
 */
import './support/next-navigation-stub';
import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import * as React from 'react';
import type { AdminFieldTranslateRequest } from '@al-ummah/shared-types';
import { emptyLangs, filterMissing, missingItems, missingLang, suggestionOf, translateBatches, translateErrorCode, userTextEdit, userTextErrors, userTextPair } from '../src/lib/localized';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

(globalThis as unknown as { React: unknown }).React = React;

describe('localized helpers', () => {
  it('finds the missing language', () => {
    assert.equal(missingLang({ en: 'News', ar: '' }), 'ar');
    assert.equal(missingLang({ en: ' ', ar: 'أخبار' }), 'en');
    assert.equal(missingLang({ en: 'News', ar: 'أخبار' }), null);
    assert.equal(missingLang({ en: '', ar: '' }), null);
    assert.deepEqual(emptyLangs({ en: '', ar: 'x' }), ['en']);
  });

  it('filters rows by missing language', () => {
    const rows = [{ id: 'a', en: 'A', ar: '' }, { id: 'b', en: '', ar: 'ب' }, { id: 'c', en: 'C', ar: 'ج' }];
    const ids = (f: Parameters<typeof filterMissing>[1]) => filterMissing(rows, f, (r) => [r]).map((r) => r.id);
    assert.deepEqual(ids('all'), ['a', 'b', 'c']);
    assert.deepEqual(ids('missing'), ['a', 'b']);
    assert.deepEqual(ids('ar'), ['a']);
    assert.deepEqual(ids('en'), ['b']);
  });

  it('plans one direction per request within the service limits', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({ id: `r${i}`, name: i % 3 ? { en: `Name ${i}`, ar: '' } : { en: '', ar: `اسم ${i}` } }));
    const items = missingItems(rows, (r) => r.id, (r) => ({ name: r.name }));
    assert.equal(items.length, 120);
    const batches = translateBatches(items);
    assert.ok(batches.every((b) => b.items.length <= 50 && b.items.every((i) => i.from === b.from && i.to === b.to)));
    assert.equal(batches.reduce((n, b) => n + b.items.length, 0), 120);
    assert.deepEqual(batches.map((b) => b.from), ['en', 'en', 'ar']);
  });

  it('reads suggestions and error codes', () => {
    assert.deepEqual(suggestionOf({ text: '', refused: 'quran', quran: [{ range: '1:1', label: '1:1' }], cached: false }), { kind: 'quran', refs: [{ range: '1:1', label: '1:1' }] });
    assert.deepEqual(suggestionOf({ text: 'أخبار', cached: true }), { kind: 'text', text: 'أخبار' });
    assert.deepEqual(suggestionOf(undefined), { kind: 'empty' });
    assert.equal(translateErrorCode('daily_limit'), 'daily_limit');
    assert.equal(translateErrorCode('weird'), 'failed');
  });

  it('a user’s text stands in the input of its own language', () => {
    assert.deepEqual(userTextPair('Lessons', undefined), { en: 'Lessons', ar: '' });
    assert.deepEqual(userTextPair('دروس', {}), { en: '', ar: 'دروس' });
    assert.deepEqual(userTextPair('', null), { en: '', ar: '' });
    // Stored languages win over the plain text, which repeats one of them
    assert.deepEqual(userTextPair('دروس', { ar: 'دروس' }), { en: '', ar: 'دروس' });
    assert.deepEqual(userTextPair('Lessons', { en: 'Lessons', ar: 'دروس' }), { en: 'Lessons', ar: 'دروس' });
  });

  it('an edit of it needs one language, or both where it had both', () => {
    const p = (en: string, ar: string) => ({ en, ar });
    assert.deepEqual(userTextErrors(p('A', ''), p('B', ''), true), []);
    assert.deepEqual(userTextErrors(p('A', ''), p('', 'ب'), true), []);
    assert.deepEqual(userTextErrors(p('A', ''), p(' ', ''), true), ['en']);
    assert.deepEqual(userTextErrors(p('', 'أ'), p('', ''), true), ['ar']);
    assert.deepEqual(userTextErrors(p('A', 'أ'), p('A', ''), true), ['ar']);
    assert.deepEqual(userTextErrors(p('A', 'أ'), p('', ''), true), ['en', 'ar']);
    assert.deepEqual(userTextErrors(p('A', 'أ'), p('', ''), false), []);
    assert.deepEqual(userTextErrors(p('A', 'أ'), p('', 'أ'), false), ['en']);
  });

  it('it sends only what changed, and languages only for a text that has them or gets a second one', () => {
    const p = (en: string, ar: string) => ({ en, ar });
    assert.deepEqual(userTextEdit(p('A', ''), p(' B ', ''), false), { plain: 'B' });
    assert.deepEqual(userTextEdit(p('A', ''), p('B', ''), true), { map: { en: 'B' } });
    assert.deepEqual(userTextEdit(p('A', ''), p('', 'ب'), false), { map: { en: '', ar: 'ب' } });
    assert.deepEqual(userTextEdit(p('A', ''), p('A', 'ب'), false), { map: { ar: 'ب' } });
    assert.deepEqual(userTextEdit(p('A', 'ب'), p('A', 'ج'), true), { map: { ar: 'ج' } });
    assert.deepEqual(userTextEdit(p('', ''), p('', ''), false), { plain: '' });
    assert.deepEqual(userTextEdit(p('A', 'ب'), p('', ''), true), { map: { en: '', ar: '' } });
  });

  it('the Arabic strings use «مرئي», never «فيديو»', () => {
    assert.ok(!JSON.stringify(ar.localized).includes('فيديو'));
    assert.deepEqual(Object.keys(ar.localized).sort(), Object.keys(en.localized).sort());
  });
});

describe('LocalizedFieldPair and Translate missing in a DOM', () => {
  let dom: JSDOM;
  before(() => {
    dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/' });
    const g = globalThis as Record<string, unknown>;
    for (const k of ['window', 'document', 'navigator', 'HTMLElement', 'Node', 'Event', 'MouseEvent', 'KeyboardEvent', 'HTMLInputElement', 'HTMLTextAreaElement', 'HTMLSelectElement', 'getComputedStyle'])
      Object.defineProperty(g, k, { value: (dom.window as unknown as Record<string, unknown>)[k], configurable: true, writable: true });
    g.IS_REACT_ACT_ENVIRONMENT = true;
  });
  after(() => dom.window.close());

  async function mount(element: React.ReactElement, locale: 'en' | 'ar' = 'en') {
    const { createRoot } = await import('react-dom/client');
    const { I18nProvider } = await import('../src/i18n/I18nProvider');
    const container = document.createElement('div');
    document.body.appendChild(container);
    const root = createRoot(container);
    const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
    await React.act(async () => root.render(React.createElement(Provider, { locale, theme: 'light' }, element)));
    return { container, unmount: () => React.act(() => root.unmount()) };
  }

  const click = (el: Element | null) => React.act(async () => void (el as HTMLElement).dispatchEvent(new window.MouseEvent('click', { bubbles: true })));
  const type = (el: Element | null, text: string) =>
    React.act(async () => {
      const input = el as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), 'value')!.set!;
      setter.call(input, text);
      input.dispatchEvent(new window.Event('input', { bubbles: true }));
    });

  /** A stateful harness around the controlled component. */
  async function pair(initial: { en: string; ar: string }, answer: (req: AdminFieldTranslateRequest) => unknown, extra: Record<string, unknown> = {}, locale: 'en' | 'ar' = 'en') {
    const { LocalizedFieldPair } = await import('../src/components/localized/LocalizedFieldPair');
    const calls: AdminFieldTranslateRequest[] = [];
    function Harness() {
      const [value, setValue] = React.useState(initial);
      return React.createElement(LocalizedFieldPair as unknown as React.FC<Record<string, unknown>>, {
        id: 'name',
        label: 'Name',
        field: 'categories.label',
        value,
        onChange: setValue,
        translate: async (req: AdminFieldTranslateRequest) => {
          calls.push(req);
          return answer(req);
        },
        ...extra,
      });
    }
    const mounted = await mount(React.createElement(Harness), locale);
    const q = (s: string) => mounted.container.querySelector(`[data-testid="${s}"]`);
    return { ...mounted, q, calls };
  }

  const ok = (text: string, refused?: string) => ({ ok: true, data: { items: [{ text, cached: false, ...(refused ? { refused, quran: [{ range: '112:1-112:4', label: '112:1–4' }] } : {}) }], provider: 'workers-ai', machineTranslation: true, usage: { used: 1, limit: 500, resetsAt: 'x' } } });

  it('points each Translate arrow at the field it fills, in either direction', async () => {
    for (const [locale, toAr, toEn] of [['en', '↓→', '↑←'], ['ar', '↓←', '↑→']] as const) {
      const p = await pair({ en: 'News', ar: 'أخبار' }, () => ok(''), {}, locale);
      const arrows = (id: string) => [...p.q(id)!.querySelectorAll('[aria-hidden]')].map((e) => e.textContent).join('');
      assert.equal(arrows('name-translate-en'), toAr, locale);
      assert.equal(arrows('name-translate-ar'), toEn, locale);
      await p.unmount();
    }
  });

  it('labels each language, sets dir/lang, and fills Arabic from English for review', async () => {
    const p = await pair({ en: 'News', ar: '' }, () => ok('أخبار'));
    const enInput = p.q('name-en') as HTMLInputElement;
    const arInput = p.q('name-ar') as HTMLInputElement;
    assert.equal(enInput.getAttribute('dir'), 'ltr');
    assert.equal(enInput.getAttribute('lang'), 'en');
    assert.equal(arInput.getAttribute('dir'), 'rtl');
    assert.equal(arInput.getAttribute('lang'), 'ar');
    assert.equal(arInput.getAttribute('aria-label'), 'Name (Arabic)');
    assert.equal(p.container.querySelector('label[for="name-ar"]')?.textContent?.replace(/\*/g, '').trim(), 'العربية');
    assert.equal((p.q('name-translate-ar') as HTMLButtonElement).disabled, true, 'nothing to translate from an empty field');
    assert.equal(p.q('name-translate-en')?.getAttribute('aria-label'), null, 'the visible words are the name (no aria-label to drift from them)');
    assert.equal(p.q('name-translate-en')?.textContent?.replace(/\s+/g, ' ').trim(), '↓→Translate to Arabic (Name)');
    await click(p.q('name-translate-en'));
    assert.deepEqual(p.calls[0], { from: 'en', to: 'ar', texts: ['News'], field: 'categories.label' });
    assert.equal((p.q('name-ar') as HTMLInputElement).value, 'أخبار');
    assert.equal(p.q('name-status')?.getAttribute('aria-live'), 'polite');
    assert.match(p.q('name-status')?.textContent ?? '', /Arabic filled by machine translation/);
    assert.equal(p.q('name-undo'), null, 'nothing was replaced, so no undo');
    await p.unmount();
  });

  it('replacing text offers Undo, which puts it back', async () => {
    const p = await pair({ en: 'Old english', ar: 'أخبار' }, () => ok('News'));
    await click(p.q('name-translate-ar'));
    assert.equal((p.q('name-en') as HTMLInputElement).value, 'News');
    assert.match(p.q('name-status')?.textContent ?? '', /replaced/);
    await click(p.q('name-undo'));
    assert.equal((p.q('name-en') as HTMLInputElement).value, 'Old english');
    assert.equal(p.q('name-undo'), null);
    await p.unmount();
  });

  it('Quran text is refused and the field is left alone; service errors are worded', async () => {
    const p = await pair({ en: '', ar: 'قل هو الله أحد' }, () => ok('', 'quran'));
    await click(p.q('name-translate-ar'));
    assert.equal((p.q('name-en') as HTMLInputElement).value, '');
    assert.match(p.q('name-status')?.textContent ?? '', /never machine-translated.*112:1–4/);
    await p.unmount();
    const limited = await pair({ en: 'News', ar: '' }, () => ({ ok: false, status: 429, error: 'daily_limit', code: 'daily_limit' }), {}, 'ar');
    await click(limited.q('name-translate-en'));
    assert.match(limited.q('name-status')?.textContent ?? '', /استنفدت ترجمات اليوم/);
    await limited.unmount();
  });

  it('a translation longer than the field is cut and says so, in the page’s digits', async () => {
    for (const [locale, words] of [
      ['en', /Arabic translation is longer than 10 characters and was cut/],
      ['ar', /أطول من ١٠ حرفًا فقُصّت/],
    ] as const) {
      const p = await pair({ en: 'News', ar: '' }, () => ok('أخبار اليوم كلها'), { maxLength: 10 }, locale);
      await click(p.q('name-translate-en'));
      assert.equal((p.q('name-ar') as HTMLInputElement).value, 'أخبار اليوم كلها'.slice(0, 10));
      assert.match(p.q('name-status')?.textContent ?? '', words);
      await p.unmount();
    }
  });

  it('a form can keep its own input test ids', async () => {
    const p = await pair({ en: 'Free', ar: '' }, () => ok('مجاني'), { inputTestIds: { en: 'tier-free-name', ar: 'tier-free-nameAr' } });
    assert.equal((p.q('tier-free-name') as HTMLInputElement).value, 'Free');
    assert.ok(p.q('tier-free-nameAr'));
    assert.equal(p.q('name-en'), null);
    assert.ok(p.q('name-translate-en'), 'the buttons keep the pair’s ids');
    await p.unmount();
  });

  it('a field error is tied to its input', async () => {
    const p = await pair({ en: 'News', ar: '' }, () => ok('x'), { errors: { ar: 'Enter the Arabic text, or use Translate.' } });
    const arInput = p.q('name-ar') as HTMLInputElement;
    assert.equal(arInput.getAttribute('aria-invalid'), 'true');
    assert.ok(arInput.getAttribute('aria-describedby')?.split(' ').includes('name-ar-error'));
    assert.equal(p.container.querySelector('#name-ar-error')?.textContent, 'Enter the Arabic text, or use Translate.');
    await p.unmount();
  });

  it('Translate missing shows every suggestion for review and saves only on Save', async () => {
    const { TranslateMissing } = await import('../src/components/localized/TranslateMissing');
    const rows = [{ id: 'a', en: 'News', ar: '' }, { id: 'b', en: '', ar: 'رياضة' }, { id: 'c', en: 'Quran', ar: '' }];
    const items = missingItems(rows, (r) => r.id, (r) => ({ label: r }));
    const saves: unknown[] = [];
    const translate = async (req: AdminFieldTranslateRequest) => ({ ok: true, data: { items: req.texts.map((t) => (t === 'Quran' ? { text: '', refused: 'quran', cached: false } : { text: req.to === 'ar' ? `ع:${t}` : `E:${t}`, cached: false })), provider: 'workers-ai', machineTranslation: true, usage: { used: 1, limit: 500, resetsAt: 'x' } } });
    const m = await mount(
      React.createElement(TranslateMissing as unknown as React.FC<Record<string, unknown>>, {
        items,
        feature: 'categories',
        rowLabel: (id: string) => `Row ${id}`,
        fieldLabel: () => 'Name',
        translate,
        onSave: async (reviewed: Array<{ key: string }>) => {
          saves.push(reviewed);
          return { saved: reviewed.map((r) => r.key) };
        },
      }),
    );
    const q = (s: string) => m.container.querySelector(`[data-testid="${s}"]`);
    assert.match(q('translate-missing-run')?.textContent ?? '', /Translate missing \(3\)/);
    await click(q('translate-missing-run'));
    assert.equal(saves.length, 0, 'nothing saved before review');
    assert.equal((q('translate-missing-text-a::label') as HTMLTextAreaElement).value, 'ع:News');
    assert.equal((q('translate-missing-text-b::label') as HTMLTextAreaElement).value, 'E:رياضة');
    assert.equal(q('translate-missing-text-b::label')?.getAttribute('dir'), 'ltr');
    assert.match(q('translate-missing-skipped')?.textContent ?? '', /Row c/);
    await type(q('translate-missing-text-a::label'), 'أخبار');
    await click(q('translate-missing-save'));
    assert.deepEqual((saves[0] as Array<{ key: string; text: string }>).map((r) => [r.key, r.text]), [['a::label', 'أخبار'], ['b::label', 'E:رياضة']]);
    assert.match(q('translate-missing-status')?.textContent ?? '', /2 saved/);
    await m.unmount();
  });
});
