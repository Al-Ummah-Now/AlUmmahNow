/**
 * In-app confirm dialog (owner rule: never window.alert/confirm/prompt or
 * beforeunload): the rendered <dialog>, type-to-confirm, en/ar strings, and a
 * scan of the sources for browser prompts.
 */
import './support/next-navigation-stub';
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import * as React from 'react';
import { I18nProvider } from '../src/i18n/I18nProvider';
import { ConfirmDialog, typedMatches } from '../src/components/content/actions';
import en from '../src/i18n/messages/en';
import ar from '../src/i18n/messages/ar';

// tsx compiles the components' JSX in classic mode (tsconfig jsx: preserve): they read the global React
(globalThis as unknown as { React: unknown }).React = React;

type DialogProps = Parameters<typeof ConfirmDialog>[0];

function render(props: Partial<DialogProps>, locale: 'en' | 'ar' = 'en'): string {
  const Provider = I18nProvider as unknown as React.FC<{ locale: string; theme: string; children?: React.ReactNode }>;
  const element = React.createElement(ConfirmDialog as unknown as React.FC<DialogProps>, {
    open: false,
    onCancel: () => undefined,
    onConfirm: () => undefined,
    title: 'Delete stale uploads?',
    body: 'Delete 3 stale uploads at Bunny now?',
    confirmLabel: 'Delete now',
    testId: 'stale-delete-confirm',
    ...props,
  });
  return renderToStaticMarkup(React.createElement(Provider, { locale, theme: 'light' }, element) as never);
}

describe('typedMatches', () => {
  it('needs the exact value when one is required', () => {
    assert.equal(typedMatches('', undefined), true);
    assert.equal(typedMatches(' DELETE ', 'DELETE'), true);
    assert.equal(typedMatches('delete', 'DELETE'), false);
    assert.equal(typedMatches('', 'my-theme'), false);
  });
});

describe('ConfirmDialog', () => {
  it('renders a labelled modal <dialog> with Cancel before the action', () => {
    const html = render({ danger: true });
    assert.match(html, /^<dialog[^>]*aria-labelledby="[^"]+-title"[^>]*aria-describedby="[^"]+-body"/);
    assert.ok(html.includes('Delete stale uploads?'));
    assert.ok(html.indexOf('stale-delete-confirm-cancel') < html.indexOf('stale-delete-confirm-confirm'), 'Cancel comes first');
    assert.ok(!/stale-delete-confirm-confirm"[^>]*disabled/.test(html), 'enabled without type-to-confirm');
  });

  it('disables the action until the required text is typed', () => {
    const html = render({ typeToConfirm: en.confirmDialog.deleteWord });
    assert.ok(html.includes('Type DELETE to confirm'));
    assert.match(html, /<button type="submit"[^>]*disabled=""[^>]*data-testid="stale-delete-confirm-confirm"/);
  });

  it('is localized in Arabic', () => {
    const html = render({ typeToConfirm: ar.confirmDialog.deleteWord }, 'ar');
    assert.ok(html.includes(`اكتب ${ar.confirmDialog.deleteWord} للتأكيد`));
    assert.ok(html.includes(ar.content.cancel));
  });
});

describe('no browser prompts', () => {
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(tsx?|js|html)$/.test(name) ? [path] : [];
    });
  }

  it('src and public use no alert/confirm/prompt or beforeunload', () => {
    const root = join(__dirname, '..');
    const offenders = ['src', 'public'].flatMap((dir) => files(join(root, dir))).filter((path) => {
      const text = readFileSync(path, 'utf8');
      return /\bwindow\.(?:alert|confirm|prompt)\s*\(/.test(text) || /['"`]beforeunload['"`]/.test(text);
    });
    assert.deepEqual(offenders, []);
  });
});
