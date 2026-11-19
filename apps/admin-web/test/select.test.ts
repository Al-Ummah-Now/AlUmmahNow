/**
 * The shared admin Select (components/select): the select-only combobox keys, typeahead, reading
 * <option>/<optgroup> children like a native select, the rendered ARIA markup in English and Arabic,
 * the hidden input forms submit, and that no native <select> is left anywhere in admin-web
 * (owner 2026-11-19).
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Select, splitClasses } from '../src/components/select/Select';
import { firstEnabled, lastEnabled, nextEnabled, readOptions, selectKey, textOf, typeahead } from '../src/components/select/select-logic';

// The components compile to React.createElement under tsx (classic JSX), as in the other render tests
(globalThis as unknown as { React: unknown }).React = React;
const h = React.createElement;

const options = readOptions([
  h('option', { key: 'a', value: '' }, 'All statuses'),
  h('option', { key: 'b', value: 'pending' }, 'Pending'),
  h('option', { key: 'c', value: 'reviewing', disabled: true }, 'Reviewing'),
  h('option', { key: 'd', value: 'resolved' }, 'Resolved'),
  h('option', { key: 'e', value: 'dismissed' }, 'Dismissed'),
]);

describe('readOptions', () => {
  it('reads values, labels and disabled options, and a missing value falls back to the text', () => {
    assert.deepEqual(
      options.map((o) => [o.value, o.text, !!o.disabled]),
      [
        ['', 'All statuses', false],
        ['pending', 'Pending', false],
        ['reviewing', 'Reviewing', true],
        ['resolved', 'Resolved', false],
        ['dismissed', 'Dismissed', false],
      ],
    );
    assert.equal(readOptions(h('option', null, 'Plain'))[0].value, 'Plain');
    assert.equal(readOptions(h('option', { value: 24 }, '24 h'))[0].value, '24', 'numbers become strings, as in the DOM');
  });

  it('flattens fragments, arrays and optgroups (a disabled group disables its options)', () => {
    const read = readOptions([
      h(React.Fragment, { key: 'f' }, [h('option', { key: 1, value: 'x' }, 'X')]),
      h('optgroup', { key: 'g', label: 'Group', disabled: true }, h('option', { value: 'y' }, 'Y')),
      false,
      null,
    ]);
    assert.deepEqual(read.map((o) => [o.value, o.group, !!o.disabled]), [['x', undefined, false], ['y', 'Group', true]]);
  });

  it('textOf joins nested strings and numbers', () => {
    assert.equal(textOf(['Page ', 2, h('b', null, ' of ', 3)]), 'Page 2 of 3');
  });
});

describe('select-only combobox keys', () => {
  const base = { options, active: 1, selected: 1 };

  it('closed: arrows, Enter and Space open on the chosen option; Home/End on the first/last', () => {
    for (const key of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) assert.deepEqual(selectKey(key, { ...base, open: false }), { kind: 'open', active: 1 });
    assert.deepEqual(selectKey('Home', { ...base, open: false }), { kind: 'open', active: 0 });
    assert.deepEqual(selectKey('End', { ...base, open: false }), { kind: 'open', active: 4 });
    assert.deepEqual(selectKey('ArrowDown', { options, active: -1, selected: -1, open: false }), { kind: 'open', active: 0 }, 'no value: the first option');
  });

  it('open: arrows skip disabled options and stop at the ends', () => {
    assert.deepEqual(selectKey('ArrowDown', { ...base, open: true }), { kind: 'move', active: 3 }, 'skips the disabled "Reviewing"');
    assert.deepEqual(selectKey('ArrowUp', { ...base, open: true, active: 3 }), { kind: 'move', active: 1 });
    assert.deepEqual(selectKey('ArrowDown', { ...base, open: true, active: 4 }), { kind: 'move', active: 4 });
    assert.deepEqual(selectKey('ArrowUp', { ...base, open: true, active: 0 }), { kind: 'move', active: 0 });
    assert.deepEqual(selectKey('PageDown', { ...base, open: true, active: 0 }), { kind: 'move', active: 4 });
    assert.deepEqual(selectKey('PageUp', { ...base, open: true, active: 4 }), { kind: 'move', active: 0 });
  });

  it('open: Enter, Space, Tab and Alt+ArrowUp pick; Escape closes without picking', () => {
    for (const key of ['Enter', ' ', 'Tab']) assert.deepEqual(selectKey(key, { ...base, open: true, active: 3 }), { kind: 'select', index: 3, close: true });
    assert.deepEqual(selectKey('ArrowUp', { ...base, open: true, active: 3, alt: true }), { kind: 'select', index: 3, close: true });
    assert.deepEqual(selectKey('Escape', { ...base, open: true, active: 3 }), { kind: 'close' });
    assert.deepEqual(selectKey('Enter', { ...base, open: true, active: 2 }), { kind: 'close' }, 'a disabled option is never picked');
  });

  it('printable keys are typeahead, open or closed; other keys do nothing', () => {
    assert.deepEqual(selectKey('r', { ...base, open: false }), { kind: 'typeahead', char: 'r' });
    assert.deepEqual(selectKey('r', { ...base, open: true }), { kind: 'typeahead', char: 'r' });
    assert.deepEqual(selectKey('F5', { ...base, open: true }), { kind: 'none' });
  });

  it('enabled-option stepping', () => {
    assert.equal(firstEnabled(options), 0);
    assert.equal(lastEnabled(options), 4);
    assert.equal(nextEnabled(options, 1, 1), 3);
  });
});

describe('typeahead', () => {
  it('jumps to the next option starting with the letter, cycling, and skips disabled ones', () => {
    assert.equal(typeahead(options, 1, 'r'), 3, '"Reviewing" is disabled, so "Resolved"');
    assert.equal(typeahead(options, 1, 'd'), 4);
    assert.equal(typeahead(options, 4, 'p'), 1, 'wraps around');
    assert.equal(typeahead(options, 1, 'res'), 3);
    assert.equal(typeahead(options, 1, 'zz'), -1);
  });

  it('matches Arabic labels as typed', () => {
    const ar = readOptions([h('option', { key: 1, value: 'a' }, 'كل الحالات'), h('option', { key: 2, value: 'b' }, 'قيد الانتظار')]);
    assert.equal(typeahead(ar, 0, 'ق'), 1);
  });
});

describe('splitClasses', () => {
  it('puts width, margins and flex placement on the wrapper, the look on the button', () => {
    assert.deepEqual(splitClasses('bg-surface-2 px-3 py-2 w-full mt-1 sm:w-48 flex-1 !py-1 text-xs'), {
      wrapper: 'w-full mt-1 sm:w-48 flex-1',
      button: 'bg-surface-2 px-3 py-2 !py-1 text-xs',
    });
  });
});

describe('rendered markup', () => {
  const render = (props: Record<string, unknown>, dir: 'ltr' | 'rtl' = 'ltr') =>
    renderToStaticMarkup(
      h('div', { dir }, h(Select, { id: 'status', name: 'status', 'data-testid': 'status-filter', ...props } as never, [
        h('option', { key: 1, value: '' }, dir === 'rtl' ? 'كل الحالات' : 'All statuses'),
        h('option', { key: 2, value: 'pending' }, dir === 'rtl' ? 'قيد الانتظار' : 'Pending'),
      ])),
    );

  it('is a button combobox with a hidden listbox and a hidden input carrying the value', () => {
    const html = render({ defaultValue: 'pending' });
    assert.match(html, /<button[^>]*type="button"[^>]*role="combobox"[^>]*aria-haspopup="listbox"[^>]*aria-expanded="false"[^>]*aria-controls="status-list"/);
    assert.match(html, /data-testid="status-filter"[^>]*data-value="pending"|data-value="pending"[^>]*data-testid="status-filter"/);
    assert.match(html, /<input type="hidden"[^>]*name="status"[^>]*value="pending"/);
    assert.match(html, /<ul[^>]*id="status-list"[^>]*role="listbox"[^>]*hidden/);
    assert.match(html, /role="option" aria-selected="true" data-value="pending"/);
    assert.match(html, /role="option" aria-selected="false" data-value=""/);
    assert.doesNotMatch(html, /<select/);
  });

  it('shows the first option when nothing is chosen, and a controlled value wins', () => {
    assert.match(render({}), /<input type="hidden"[^>]*name="status"[^>]*value=""/);
    assert.match(render({ value: 'pending', onChange: () => {} }), /value="pending"/);
  });

  it('renders right to left with the Arabic labels', () => {
    const html = render({ defaultValue: '' }, 'rtl');
    assert.match(html, /<div dir="rtl">/);
    assert.match(html, /كل الحالات/);
    assert.match(html, /قيد الانتظار/);
  });
});

describe('no native <select> in admin-web', () => {
  const root = join(__dirname, '..', 'src');
  const files: string[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.tsx?$/.test(name)) files.push(p);
    }
  };
  walk(root);

  it('every select is the shared Select (the theme preview document mimics a site page and is HTML text)', () => {
    const offenders = files
      .filter((f) => !f.endsWith('preview-document.ts') && !f.includes(`${join('components', 'select')}`))
      .filter((f) => /<select[\s>]/.test(readFileSync(f, 'utf8')))
      .map((f) => f.slice(root.length + 1));
    assert.deepEqual(offenders, []);
  });
});
