/**
 * Dialogs are portalled to the body, outside the page's dir wrapper, so each shared dialog sets the
 * page direction itself (useTextDirection: the document's dir, no providers needed, so embeds work too): in Arabic it is right to left (text at the start, actions mirrored at the
 * end edge). Covers the three shared dialogs every in-app dialog is built on.
 */
import React from 'react';
import { render, screen } from '@testing-library/react';

let lang: 'en' | 'ar' = 'ar';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang,
    locale: lang,
    isRTL: lang === 'ar',
    dir: lang === 'ar' ? 'rtl' : 'ltr',
  }),
}));

import { AlertDialog, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from '../alert-dialog';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '../dialog';
import { ConfirmDialog } from '../confirm-dialog';
import { LocaleOverrideContext } from '@/lib/i18n/locale-override';

// The root layout sets <html dir> from the locale
beforeEach(() => {
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
});
const setLang = (next: 'en' | 'ar') => {
  lang = next;
  document.documentElement.dir = next === 'ar' ? 'rtl' : 'ltr';
};

const alertDialog = () =>
  render(
    <AlertDialog open>
      <AlertDialogContent>
        <AlertDialogHeader data-testid="header">
          <AlertDialogTitle>حذف</AlertDialogTitle>
          <AlertDialogDescription>نص</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter data-testid="footer" />
      </AlertDialogContent>
    </AlertDialog>,
  );

const dialog = () =>
  render(
    <Dialog open>
      <DialogContent>
        <DialogHeader data-testid="header">
          <DialogTitle>عنوان</DialogTitle>
          <DialogDescription>نص</DialogDescription>
        </DialogHeader>
        <DialogFooter data-testid="footer" />
      </DialogContent>
    </Dialog>,
  );

describe.each([
  ['AlertDialog', alertDialog, 'alertdialog'],
  ['Dialog', dialog, 'dialog'],
] as const)('%s direction', (_name, show, role) => {
  it('is right to left in Arabic, start aligned, actions at the end edge', () => {
    setLang('ar');
    show();
    expect(screen.getByRole(role)).toHaveAttribute('dir', 'rtl');
    const header = screen.getByTestId('header');
    expect(header.className).toContain('text-start');
    expect(header.className).not.toMatch(/text-(left|right|center)/);
    expect(screen.getByTestId('footer').className).toContain('sm:justify-end');
    expect(screen.getByTestId('footer').className).not.toMatch(/space-x|ml-|mr-/);
  });

  it('is left to right in English', () => {
    setLang('en');
    show();
    expect(screen.getByRole(role)).toHaveAttribute('dir', 'ltr');
  });
});

describe('ConfirmDialog direction', () => {
  it.each([['ar', 'rtl'], ['en', 'ltr']] as const)('%s is %s', (l, dir) => {
    setLang(l);
    render(<ConfirmDialog open onResult={() => undefined} title="x" confirmLabel="ok" />);
    expect(screen.getByRole('alertdialog')).toHaveAttribute('dir', dir);
  });
});

describe('embed frames', () => {
  it('follow the ?lang= override even when the document is left to right', () => {
    setLang('en');
    render(
      <LocaleOverrideContext.Provider value="ar">
        <Dialog open>
          <DialogContent>
            <DialogTitle>عنوان</DialogTitle>
            <DialogDescription>نص</DialogDescription>
          </DialogContent>
        </Dialog>
      </LocaleOverrideContext.Provider>,
    );
    expect(screen.getByRole('dialog')).toHaveAttribute('dir', 'rtl');
  });
});
