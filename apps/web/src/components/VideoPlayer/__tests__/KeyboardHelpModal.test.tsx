/**
 * Story 1.4 AC 3 - keyboard shortcuts are documented and discoverable;
 * the help dialog is keyboard operable (focus trap, Escape, focus restore).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { KeyboardHelpModal, splitKeyCombo, splitShortcutKeys } from '../KeyboardHelpModal';

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
    expect(screen.getByText('Turn captions on or off')).toBeInTheDocument();
    expect(screen.getByText('Theatre mode')).toBeInTheDocument();
    expect(screen.getByText('Next video')).toBeInTheDocument();
  });

  it('moves focus in, traps Tab, closes on Escape and restores focus', () => {
    render(<Harness />);
    const opener = screen.getByText('opener');
    opener.focus();
    fireEvent.click(opener);

    // The X is the only button: no second Close in a footer
    const [close] = screen.getAllByRole('button', { name: 'Close' });
    expect(screen.getAllByRole('button')).toHaveLength(2); // the opener and the X
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(close, { key: 'Tab' });
    expect(document.activeElement).toBe(close);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.activeElement).toBe(opener);
  });

  it('renders the Arabic (RTL) variant; arrows follow the left-to-right progress bar', () => {
    render(<KeyboardHelpModal isOpen onClose={jest.fn()} lang="ar" />);
    const dialog = screen.getByRole('dialog', { name: 'اختصارات لوحة المفاتيح' });
    expect(dialog).toHaveAttribute('dir', 'rtl');
    // The bar stays left to right in Arabic, so Left rewinds and Right seeks forward
    const rewindRow = screen.getByText('الرجوع ٥ ثوانٍ').closest('div')!;
    expect(rewindRow).toHaveTextContent('←');
    const forwardRow = screen.getByText('التقديم ٥ ثوانٍ').closest('div')!;
    expect(forwardRow).toHaveTextContent('→');
  });

  it('portals to the body over a scrim, out of the player frame', () => {
    const frame = document.createElement('div');
    frame.className = 'video-js';
    document.body.appendChild(frame);
    render(<KeyboardHelpModal isOpen onClose={jest.fn()} lang="en" playerElement={frame} />, { container: frame });
    const layer = screen.getByTestId('player-shortcuts-layer');
    expect(layer.parentElement).toBe(document.body);
    expect(layer).toHaveAttribute('data-player-layer');
    expect(frame.contains(layer)).toBe(false);
    frame.remove();
  });

  it('follows the player into its fullscreen element', () => {
    const frame = document.createElement('div');
    document.body.appendChild(frame);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => frame });
    render(<KeyboardHelpModal isOpen onClose={jest.fn()} lang="en" playerElement={frame} />);
    expect(screen.getByTestId('player-shortcuts-layer').parentElement).toBe(frame);
    Object.defineProperty(document, 'fullscreenElement', { configurable: true, get: () => null });
    frame.remove();
  });

  it('closes only with the X or Escape, not by clicking the scrim', () => {
    const onClose = jest.fn();
    render(<KeyboardHelpModal isOpen onClose={onClose} lang="en" />);
    fireEvent.click(screen.getByTestId('player-shortcuts-layer'));
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId('player-shortcuts-close'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('shows every shortcut with at least one key chip, combinations as one chip per key', () => {
    render(<KeyboardHelpModal isOpen onClose={jest.fn()} lang="en" />);
    const rows = screen.getAllByTestId('player-shortcut-row');
    expect(rows.length).toBeGreaterThanOrEqual(20);
    for (const row of rows) expect(row.querySelectorAll('kbd').length).toBeGreaterThan(0);
    const tab = screen.getByText('Move between player controls').closest('[data-testid="player-shortcut-row"]')!;
    expect(Array.from(tab.querySelectorAll('kbd')).map((k) => k.textContent)).toEqual(['Tab', 'Shift', 'Tab']);
  });

  it('splits key lists on English and Arabic commas', () => {
    expect(splitShortcutKeys('Space, K')).toEqual(['Space', 'K']);
    expect(splitShortcutKeys('مسافة، K')).toEqual(['مسافة', 'K']);
    expect(splitKeyCombo('Shift+Tab')).toEqual(['Shift', 'Tab']);
    expect(splitKeyCombo('+')).toEqual(['+']);
  });
});
