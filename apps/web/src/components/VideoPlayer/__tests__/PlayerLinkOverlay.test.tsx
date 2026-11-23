/**
 * In-player links (PlayerLinkOverlay): a small data-driven slot; the first link is Quran Foundation's
 * credit next to Quran captions (QF 2026-11-23).
 */
import { act, fireEvent, render, screen } from '@testing-library/react';
import { PlayerLinkOverlay, isExternalHref } from '../PlayerLinkOverlay';

const qf = { id: 'quran-foundation', label: 'Source: Quran Foundation', ariaLabel: 'Source: Quran Foundation (opens in a new tab)', href: 'https://quran.foundation/', placement: 'caption-end' as const, testId: 'player-quran-credit' };

describe('PlayerLinkOverlay', () => {
  it('renders nothing without links', () => {
    const { container } = render(<PlayerLinkOverlay links={[]} dir="ltr" />);
    expect(container).toBeEmptyDOMElement();
  });

  it('a link to another site: a real link in a new tab, rel=noopener, named for screen readers', () => {
    render(<PlayerLinkOverlay links={[qf]} dir="ltr" />);
    const link = screen.getByRole('link', { name: 'Source: Quran Foundation (opens in a new tab)' });
    expect(link).toHaveAttribute('href', 'https://quran.foundation/');
    expect(link).toHaveAttribute('target', '_blank');
    expect(link).toHaveAttribute('rel', 'noopener');
    expect(link).toHaveTextContent('Source: Quran Foundation');
    expect(link.parentElement).toHaveAttribute('data-placement', 'caption-end');
    // Keyboard reachable: an <a href> in the tab order
    expect(link.tabIndex).toBe(0);
  });

  it('a press on the link never reaches the player (no play/pause, no seek gesture)', () => {
    const onPlayerClick = jest.fn();
    const onPlayerPointer = jest.fn();
    render(
      <div onClick={onPlayerClick} onPointerDown={onPlayerPointer} onDoubleClick={onPlayerClick}>
        <PlayerLinkOverlay links={[qf]} dir="rtl" />
      </div>,
    );
    const link = screen.getByTestId('player-quran-credit');
    link.addEventListener('click', (e) => e.preventDefault());
    fireEvent.pointerDown(link);
    fireEvent.click(link);
    fireEvent.doubleClick(link);
    expect(onPlayerClick).not.toHaveBeenCalled();
    expect(onPlayerPointer).not.toHaveBeenCalled();
    expect(link.parentElement).toHaveAttribute('dir', 'rtl');
  });

  it('a link on this site opens in place', () => {
    render(<PlayerLinkOverlay links={[{ ...qf, id: 'own', href: '/en/credits', ariaLabel: undefined, label: 'Credits' }]} dir="ltr" />);
    const link = screen.getByRole('link', { name: 'Credits' });
    expect(link).not.toHaveAttribute('target');
    expect(isExternalHref('https://quran.foundation/', 'https://alummahnow.net')).toBe(true);
    expect(isExternalHref('https://alummahnow.net/en', 'https://alummahnow.net')).toBe(false);
    expect(isExternalHref('/en/credits', 'https://alummahnow.net')).toBe(false);
  });

  it('a link whose moment passed stays while it has focus or the pointer, then goes', () => {
    const { rerender } = render(<PlayerLinkOverlay links={[qf]} dir="ltr" />);
    const link = screen.getByTestId('player-quran-credit');
    act(() => link.focus());
    fireEvent.focus(link);
    rerender(<PlayerLinkOverlay links={[]} dir="ltr" />);
    expect(screen.getByTestId('player-quran-credit')).toBe(link);
    fireEvent.blur(link);
    expect(screen.queryByTestId('player-quran-credit')).toBeNull();

    rerender(<PlayerLinkOverlay links={[qf]} dir="ltr" />);
    fireEvent.pointerEnter(screen.getByTestId('player-quran-credit'));
    rerender(<PlayerLinkOverlay links={[]} dir="ltr" />);
    expect(screen.getByTestId('player-quran-credit')).toBeInTheDocument();
    fireEvent.pointerLeave(screen.getByTestId('player-quran-credit'));
    expect(screen.queryByTestId('player-quran-credit')).toBeNull();
  });

  it('follows the direction of the link (a credit follows its cue, not the page)', () => {
    render(<PlayerLinkOverlay links={[{ ...qf, dir: 'rtl', lang: 'ar', label: 'المصدر: مؤسسة القرآن' }]} dir="ltr" />);
    const link = screen.getByTestId('player-quran-credit');
    expect(link.parentElement).toHaveAttribute('dir', 'rtl');
    expect(link).toHaveAttribute('lang', 'ar');
  });
});
