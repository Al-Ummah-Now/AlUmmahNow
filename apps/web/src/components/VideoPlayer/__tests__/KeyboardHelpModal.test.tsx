/**
 * Story 1.4 AC 3 - keyboard shortcuts are documented and discoverable;
 * the help dialog is keyboard operable (focus trap, Escape, focus restore).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardHelpModal, splitShortcutKeys } from '../KeyboardHelpModal';
import { addHelpButton } from '@/lib/video/keyboard-shortcuts';
import type { ExtendedPlayer } from '@/lib/video/videojs';

function Harness({ lang = 'en' as 'en' | 'ar' }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button onClick={() => setOpen(true)}>opener</button>
      <KeyboardHelpModal isOpen={open} onClose={() => setOpen(false)} lang={lang} />
    </>
  );
}

describe('KeyboardHelpModal', () => {
  it('is a labelled modal dialog listing every shortcut group', () => {
    render(<KeyboardHelpModal isOpen onClose={jest.fn()} lang="en" />);
    const dialog = screen.getByRole('dialog', { name: 'Keyboard Shortcuts' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    expect(dialog).toHaveAccessibleDescription('Control the video player with your keyboard');
    for (const section of ['Playback', 'Seeking', 'Volume', 'Display', 'Speed', 'Navigation']) {
      expect(screen.getByRole('heading', { name: section })).toBeInTheDocument();
    }
    expect(screen.getByText('Show this list of shortcuts')).toBeInTheDocument();
    expect(screen.getByText('Move between player controls')).toBeInTheDocument();
  });

  it('moves focus in, traps Tab, closes on Escape and restores focus', () => {
    render(<Harness />);
    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);

    const headerClose = screen.getByRole('button', { name: 'Close' });
    expect(document.activeElement).toBe(headerClose);

    headerClose.focus();
    fireEvent.keyDown(headerClose, { key: 'Tab' });
    expect(document.activeElement).toBe(headerClose);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('renders the Arabic (RTL) variant with RTL-correct arrow keys', () => {
    render(<KeyboardHelpModal isOpen onClose={jest.fn()} lang="ar" />);
    const dialog = screen.getByRole('dialog', { name: 'اختصارات لوحة المفاتيح' });
    expect(dialog).toHaveAttribute('dir', 'rtl');
    // In RTL ArrowRight rewinds and ArrowLeft seeks forward (keyboard-shortcuts.ts)
    const rewindRow = screen.getByText('الرجوع ٥ ثوانٍ').closest('div')!;
    expect(rewindRow).toHaveTextContent('→');
    const forwardRow = screen.getByText('التقديم ٥ ثوانٍ').closest('div')!;
    expect(forwardRow).toHaveTextContent('←');
  });

  it('splits key lists on English and Arabic commas', () => {
    expect(splitShortcutKeys('Space, K')).toEqual(['Space', 'K']);
    expect(splitShortcutKeys('مسافة، K')).toEqual(['مسافة', 'K']);
  });
});

describe('addHelpButton (shortcut discovery in the control bar)', () => {
  function fakePlayer() {
    const root = document.createElement('div');
    root.innerHTML = '<div class="vjs-control-bar"><button class="vjs-fullscreen-control"></button></div>';
    document.body.appendChild(root);
    return { el: () => root } as unknown as ExtendedPlayer;
  }

  it.each([
    ['en', 'Show keyboard shortcuts'],
    ['ar', 'عرض اختصارات لوحة المفاتيح'],
  ] as const)('adds a localized, labelled button (%s)', (lang, label) => {
    const onShowHelp = jest.fn();
    const cleanup = addHelpButton(fakePlayer(), onShowHelp, lang);
    const button = screen.getAllByRole('button', { name: label })[0];
    expect(button).toHaveAttribute('aria-haspopup', 'dialog');
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Shift+Slash');
    // Placed before fullscreen so the tab order matches the visual order
    expect(button.nextElementSibling).toHaveClass('vjs-fullscreen-control');
    fireEvent.click(button);
    expect(onShowHelp).toHaveBeenCalled();
    cleanup();
    expect(screen.queryByRole('button', { name: label })).not.toBeInTheDocument();
  });
});
