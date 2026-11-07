/**
 * Story 1.4 - chapter list keyboard pattern and focus management;
 * Story 1.5 - chapter controls meet the 44px minimum (min-h-11 / min-w-11).
 */
import React, { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import type { VideoChapter } from '@al-ummah/shared-types';
import { ChapterList } from '../ChapterList';
import { ChapterMarkers } from '../ChapterMarkers';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));

beforeAll(() => {
  Element.prototype.scrollIntoView = jest.fn();
});

const chapters = [
  { id: 'c1', title: 'Introduction', startTime: 0 },
  { id: 'c2', title: 'Main topic', startTime: 60 },
  { id: 'c3', title: 'Questions', startTime: 120 },
] as unknown as VideoChapter[];

function Harness({ onSeek = jest.fn() }: { onSeek?: (c: VideoChapter) => void }) {
  const [open, setOpen] = useState(false);
  return (
    <ChapterList
      chapters={chapters}
      currentChapter={chapters[1]}
      currentChapterIndex={1}
      onSeek={onSeek}
      isOpen={open}
      onToggle={() => setOpen((v) => !v)}
    />
  );
}

describe('ChapterList keyboard accessibility', () => {
  it('moves focus to the current chapter on open and back to the toggle on Escape', () => {
    render(<Harness />);
    const toggle = screen.getByRole('button', { name: 'Show Chapters 3' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(toggle);

    const current = screen.getByRole('button', { name: /Main topic/ });
    expect(current).toHaveAttribute('aria-current', 'true');
    expect(document.activeElement).toBe(current);

    fireEvent.keyDown(current, { key: 'Escape' });
    expect(screen.queryByRole('navigation', { name: 'Chapter List' })).not.toBeInTheDocument();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show Chapters 3' }));
  });

  it('arrow keys move focus without seeking; Enter/click seeks', () => {
    const onSeek = jest.fn();
    render(<Harness onSeek={onSeek} />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Chapters 3' }));
    const nav = screen.getByRole('navigation', { name: 'Chapter List' });

    fireEvent.keyDown(nav, { key: 'ArrowDown' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Questions/ }));
    fireEvent.keyDown(nav, { key: 'Home' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Introduction/ }));
    fireEvent.keyDown(nav, { key: 'End' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: /Questions/ }));
    expect(onSeek).not.toHaveBeenCalled();

    fireEvent.click(document.activeElement as HTMLElement);
    expect(onSeek).toHaveBeenCalledWith(chapters[2]);
  });

  it('chapter items and the close button use the 44px minimum target classes', () => {
    render(<Harness />);
    fireEvent.click(screen.getByRole('button', { name: 'Show Chapters 3' }));
    expect(screen.getByRole('button', { name: 'Close' })).toHaveClass('min-w-11', 'min-h-11');
    for (const item of screen.getAllByRole('button', { name: /Introduction|Main topic|Questions/ })) {
      expect(item).toHaveClass('min-h-11');
    }
  });
});

describe('ChapterMarkers', () => {
  it('are pointer-only shortcuts hidden from the tab order inside the seek slider', () => {
    const { container } = render(
      <ChapterMarkers chapters={chapters} currentChapter={null} duration={180} onSeek={jest.fn()} direction="ltr" />
    );
    const group = container.firstElementChild as HTMLElement;
    expect(group).toHaveAttribute('aria-hidden', 'true');
    const markers = container.querySelectorAll('button');
    expect(markers).toHaveLength(2); // the 0:00 chapter has no marker
    markers.forEach((marker) => expect(marker).toHaveAttribute('tabindex', '-1'));
  });
});
