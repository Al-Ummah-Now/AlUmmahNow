/**
 * The "Add channel section" dialog: the section-type picker (option cards grouped under
 * headings), picking a type opens its form, keyboard use (arrow keys, Home/End, Escape) in
 * both directions, and the option-card styles reading theme part tokens only.
 */
import React from 'react';
import fs from 'fs';
import path from 'path';
import { render, screen, within, fireEvent, waitFor } from '@testing-library/react';
import { AddSectionDialog, SECTION_TYPES, SECTION_TYPE_GROUPS } from '../management/AddSectionDialog';

const mockLanguage = { isRTL: false };

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const { EN_TRANSLATIONS, AR_TRANSLATIONS } = jest.requireActual('@/lib/i18n/translations');
    return {
      t: mockLanguage.isRTL ? AR_TRANSLATIONS : EN_TRANSLATIONS,
      lang: mockLanguage.isRTL ? 'ar' : 'en',
      locale: mockLanguage.isRTL ? 'ar' : 'en',
      dir: mockLanguage.isRTL ? 'rtl' : 'ltr',
      isRTL: mockLanguage.isRTL,
    };
  },
}));

function openDialog(onAdd = jest.fn()) {
  render(<AddSectionDialog channelId="ch-1" onAdd={onAdd} />);
  fireEvent.click(screen.getByTestId('add-section-button'));
  return screen.getByRole('dialog');
}

const options = (dialog: HTMLElement) => Array.from(dialog.querySelectorAll<HTMLButtonElement>('[data-section-type]'));

describe('AddSectionDialog', () => {
  beforeEach(() => {
    mockLanguage.isRTL = false;
  });

  it('lists every section type once, as option cards grouped under headings', () => {
    const dialog = openDialog();
    expect(within(dialog).getByRole('heading', { name: 'Add channel section' })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('Choose what this section shows on your channel.');

    const picker = within(dialog).getByTestId('section-type-options');
    const groups = within(picker).getAllByRole('group');
    expect(groups.map((g) => g.getAttribute('aria-labelledby') && document.getElementById(g.getAttribute('aria-labelledby')!)?.textContent)).toEqual(['Videos', 'Playlists', 'Channels']);

    const types = options(dialog).map((o) => o.dataset.sectionType);
    expect(types).toHaveLength(7);
    expect([...types].sort()).toEqual([...SECTION_TYPES].sort());
    expect(types).toEqual(SECTION_TYPE_GROUPS.flatMap((g) => g.types));

    // Each card: a button named by all it shows (title, then its one-line description), with an icon
    const recent = within(dialog).getByRole('button', { name: /^Recent uploads/ });
    expect(recent).toHaveAccessibleName('Recent uploads Your latest videos');
    expect(recent).toHaveClass('opt');
    expect(recent).toHaveAttribute('type', 'button');
    expect(recent.querySelector('.opt-icon svg')).not.toBeNull();
    // Option cards are not primary buttons: no Tailwind colour classes for the theme bridge to catch
    for (const option of options(dialog)) expect(option.className).not.toMatch(/\bbg-/);
  });

  it('picking a type opens its form, and Cancel returns focus to that card', async () => {
    const dialog = openDialog();
    fireEvent.click(within(dialog).getByRole('button', { name: /^Featured playlists/ }));

    expect(within(dialog).getByRole('heading', { name: 'Configure section' })).toBeInTheDocument();
    expect(dialog).toHaveAccessibleDescription('Specific playlists you choose');
    expect(within(dialog).queryByTestId('section-type-options')).toBeNull();
    expect(within(dialog).getByLabelText(/Section title/)).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Playlist IDs/)).toBeInTheDocument();

    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(within(dialog).getByRole('heading', { name: 'Add channel section' })).toBeInTheDocument();
    await waitFor(() => expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: /^Featured playlists/ })));
  });

  it('submits the picked type through onAdd and closes', async () => {
    const onAdd = jest.fn().mockResolvedValue(undefined);
    const dialog = openDialog(onAdd);
    fireEvent.click(within(dialog).getByRole('button', { name: /^Recent uploads/ }));
    fireEvent.change(within(dialog).getByLabelText(/Section title/), { target: { value: 'Newest' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Create section' }));

    await waitFor(() => expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ type: 'recent_uploads', title: 'Newest' })));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('moves between cards with the arrow keys and Home/End, one card in the tab order', async () => {
    const dialog = openDialog();
    const all = options(dialog);
    await waitFor(() => expect(document.activeElement).toBe(all[0]));
    expect(all.filter((o) => o.tabIndex === 0)).toEqual([all[0]]);

    fireEvent.keyDown(all[0], { key: 'ArrowDown' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all[2]);
    fireEvent.keyDown(all[2], { key: 'ArrowUp' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1], { key: 'End' });
    expect(document.activeElement).toBe(all[6]);
    fireEvent.keyDown(all[6], { key: 'ArrowDown' }); // wraps
    expect(document.activeElement).toBe(all[0]);
    fireEvent.keyDown(all[0], { key: 'Home' });
    expect(document.activeElement).toBe(all[0]);
    // The focused card is now the one Tab reaches
    fireEvent.keyDown(all[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(all[6]);
    expect(all.filter((o) => o.tabIndex === 0)).toEqual([all[6]]);
  });

  it('in Arabic the dialog is right-to-left and ArrowLeft moves forward', async () => {
    mockLanguage.isRTL = true;
    const dialog = openDialog();
    expect(dialog).toHaveAttribute('dir', 'rtl');
    expect(within(dialog).getByRole('heading', { name: 'إضافة قسم للقناة' })).toBeInTheDocument();
    expect(within(dialog).getByRole('button', { name: /^أحدث الفيديوهات/ })).toHaveAccessibleName('أحدث الفيديوهات أحدث فيديوهاتك');
    const all = options(dialog);
    await waitFor(() => expect(document.activeElement).toBe(all[0]));
    fireEvent.keyDown(all[0], { key: 'ArrowLeft' });
    expect(document.activeElement).toBe(all[1]);
    fireEvent.keyDown(all[1], { key: 'ArrowRight' });
    expect(document.activeElement).toBe(all[0]);
  });

  it('Escape closes the dialog and focus returns to the Add section button', async () => {
    const dialog = openDialog();
    fireEvent.keyDown(dialog, { key: 'Escape' });
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(screen.getByTestId('add-section-button')));
  });
});

describe('option card styles (system.css)', () => {
  const css = fs.readFileSync(path.join(__dirname, '../../../theme/system.css'), 'utf8');
  const block = css.slice(css.indexOf('/* Option cards:'));

  it('use theme tokens only: no hard-coded colours', () => {
    const rules = block.replace(/\/\*[\s\S]*?\*\//g, '');
    expect(rules).toMatch(/\.opt\{/);
    expect(rules).not.toMatch(/#[0-9a-f]{3,8}\b|rgba?\(|hsla?\(/i);
    for (const v of rules.match(/var\(--[a-z0-9-]+/g) ?? []) expect(v).toMatch(/var\(--(fanous-|m-|r-|opt-)/);
  });

  it('keeps 44px targets, a focus ring and a non-pill radius', () => {
    expect(block).toMatch(/\.opt\{[^}]*min-height:72px/);
    expect(block).toMatch(/\.opt-icon\{[^}]*width:44px;height:44px/);
    expect(block).toMatch(/\.opt:focus-visible\{outline:2px solid var\(--fanous-c-form-focus-ring\)/);
    expect(block).toMatch(/\.opt\{[^}]*border-radius:var\(--r-lg\)/);
  });
});

describe('theme bridge selectors', () => {
  const theme = path.join(__dirname, '../../../theme');
  it('match Tailwind background classes only as base classes, never through hover:/dark: variants', () => {
    for (const file of ['bridge.css', 'system.css', 'pages.css']) {
      const css = fs.readFileSync(path.join(theme, file), 'utf8');
      // [class*="bg-…"] also matches "hover:bg-…": the bug that turned option cards into gold pills
      expect(css.match(/\[class\*="bg-[^"]*"\]/g) ?? []).toEqual([]);
    }
  });

  it('do not style a hover-only button as the primary button', () => {
    const primary = 'button:is([class^="bg-blue-"],[class*=" bg-blue-"])';
    const css = fs.readFileSync(path.join(theme, 'system.css'), 'utf8');
    expect(css).toContain(primary);
    document.body.innerHTML = '<button class="p-3 hover:bg-blue-50 dark:hover:bg-blue-900/20">a</button><button class="px-4 bg-blue-600 text-white">b</button>';
    const [option, primaryButton] = Array.from(document.querySelectorAll('button'));
    expect(option.matches(primary)).toBe(false);
    expect(primaryButton.matches(primary)).toBe(true);
  });
});
