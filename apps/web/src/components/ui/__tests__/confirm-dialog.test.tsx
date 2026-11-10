/**
 * In-app confirm dialog (replaces window.confirm) and the leave guard
 * (replaces beforeunload prompts).
 */
import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { ConfirmDialog, typedMatches, useConfirm, type ConfirmOptions } from '@/components/ui/confirm-dialog';
import { leavingHref } from '@/hooks/useLeaveGuard';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));

describe('typedMatches', () => {
  it('passes without a required value and needs an exact match otherwise', () => {
    expect(typedMatches('', undefined)).toBe(true);
    expect(typedMatches('DELETE', 'DELETE')).toBe(true);
    expect(typedMatches('  DELETE ', 'DELETE')).toBe(true);
    expect(typedMatches('delete', 'DELETE')).toBe(false);
    expect(typedMatches('', 'DELETE')).toBe(false);
  });
});

describe('ConfirmDialog', () => {
  const base = { title: 'Delete video?', description: 'This cannot be undone.', confirmLabel: 'Delete', testId: 'dlg' };

  it('is labelled by its title and description and focuses Cancel first', async () => {
    render(<ConfirmDialog open onResult={jest.fn()} {...base} />);
    const dialog = screen.getByRole('alertdialog');
    expect(dialog).toHaveAccessibleName('Delete video?');
    expect(dialog).toHaveAccessibleDescription('This cannot be undone.');
    await waitFor(() => expect(screen.getByTestId('dlg-cancel')).toHaveFocus());
  });

  it('reports false on Cancel and on Escape, true on confirm', async () => {
    const onResult = jest.fn();
    const { rerender } = render(<ConfirmDialog open onResult={onResult} {...base} />);
    await userEvent.click(screen.getByTestId('dlg-cancel'));
    expect(onResult).toHaveBeenLastCalledWith(false);

    rerender(<ConfirmDialog open onResult={onResult} {...base} testId="dlg2" />);
    fireEvent.keyDown(screen.getByRole('alertdialog'), { key: 'Escape' });
    expect(onResult).toHaveBeenLastCalledWith(false);

    rerender(<ConfirmDialog open onResult={onResult} {...base} testId="dlg3" />);
    await userEvent.click(screen.getByTestId('dlg3-confirm'));
    expect(onResult).toHaveBeenLastCalledWith(true);
  });

  it('cancels on a backdrop click', async () => {
    const onResult = jest.fn();
    render(<ConfirmDialog open onResult={onResult} {...base} />);
    fireEvent.click(screen.getByTestId('dlg-backdrop'));
    expect(onResult).toHaveBeenCalledWith(false);
  });

  it('keeps confirm disabled until the required text is typed', async () => {
    const onResult = jest.fn();
    render(<ConfirmDialog open onResult={onResult} {...base} typeToConfirm="DELETE" />);
    const confirm = screen.getByTestId('dlg-confirm');
    expect(confirm).toBeDisabled();
    expect(screen.getByLabelText('Type DELETE to confirm')).toBeInTheDocument();
    await userEvent.type(screen.getByTestId('dlg-typed'), 'DELET');
    expect(confirm).toBeDisabled();
    await userEvent.type(screen.getByTestId('dlg-typed'), 'E');
    expect(confirm).toBeEnabled();
    await userEvent.click(confirm);
    expect(onResult).toHaveBeenCalledWith(true);
  });
});

describe('useConfirm', () => {
  function Harness({ options, onDone }: { options: ConfirmOptions; onDone: (v: boolean) => void }) {
    const { confirm, dialog } = useConfirm();
    return (
      <>
        <button type="button" onClick={async () => onDone(await confirm(options))}>
          open
        </button>
        {dialog}
      </>
    );
  }

  it('resolves with the choice and closes', async () => {
    const onDone = jest.fn();
    render(<Harness options={{ title: 'Remove account?', confirmLabel: 'Remove', testId: 'h' }} onDone={onDone} />);
    expect(screen.queryByRole('alertdialog')).toBeNull();
    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByTestId('h-confirm'));
    await waitFor(() => expect(onDone).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('alertdialog')).toBeNull();

    await userEvent.click(screen.getByText('open'));
    await userEvent.click(screen.getByTestId('h-cancel'));
    await waitFor(() => expect(onDone).toHaveBeenLastCalledWith(false));
  });
});

describe('leavingHref', () => {
  const current = new URL('https://qa.alummahnow.net/en/upload');
  function click(html: string, init: MouseEventInit = {}) {
    document.body.innerHTML = html;
    const event = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0, ...init });
    Object.defineProperty(event, 'target', { value: document.body.querySelector('[data-t]') });
    return leavingHref(event, current);
  }

  it('returns the destination of a plain link click', () => {
    expect(click('<a data-t href="/en/library">x</a>')?.pathname).toBe('/en/library');
    expect(click('<a href="https://example.com/"><span data-t>x</span></a>')?.origin).toBe('https://example.com');
  });

  it('ignores clicks that do not leave this tab or page', () => {
    expect(click('<a data-t href="/en/library">x</a>', { metaKey: true })).toBeNull();
    expect(click('<a data-t href="/en/library" target="_blank">x</a>')).toBeNull();
    expect(click('<a data-t href="/file.mp4" download>x</a>')).toBeNull();
    expect(click('<a data-t href="#details">x</a>')).toBeNull();
    expect(click('<button data-t>x</button>')).toBeNull();
    expect(click('<a data-t href="mailto:a@b.c">x</a>')).toBeNull();
  });
});

describe('no browser prompts in public/', () => {
  // ESLint ignores public/ (service worker and static scripts); scan it here
  function files(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) return files(path);
      return /\.(js|html)$/.test(name) ? [path] : [];
    });
  }

  it('has no alert/confirm/prompt calls or beforeunload listeners', () => {
    const root = join(__dirname, '../../../../public');
    const offenders = files(root).filter((path) => {
      const text = readFileSync(path, 'utf8');
      return /\b(?:window\.)?(?:alert|confirm|prompt)\s*\(/.test(text) || /['"`]beforeunload['"`]/.test(text);
    });
    expect(offenders).toEqual([]);
  });
});
