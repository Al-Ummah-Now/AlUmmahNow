/**
 * A video with chapters shows a chapter bar under the player. The skeleton holds
 * that bar's place, in the same box as ChapterNav, so the title and everything
 * under it stay put when the page loads (WATCH-LOAD-004).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import { WatchDetailsSkeleton } from '../WatchPageSkeleton';
import { CHAPTER_NAV_BOX, ChapterNav } from '@/components/VideoPagePlayer/ChapterNav';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({ t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS, lang: 'en', isRTL: false }),
}));

describe('watch skeleton chapter bar', () => {
  it('holds the chapter bar under the player when the video has chapters', () => {
    const { container } = render(<WatchDetailsSkeleton hint={{ title: 'A lecture', chapters: true }} />);
    const frame = container.querySelector('.wsk-player-frame')!;
    expect(frame.querySelector('.wsk-player')).not.toBeNull();
    expect(frame.querySelector('[data-testid="chapter-nav-placeholder"]')).not.toBeNull();
  });

  it('holds nothing for a video without chapters, or when nothing is known yet', () => {
    render(<WatchDetailsSkeleton hint={{ title: 'A lecture' }} />);
    render(<WatchDetailsSkeleton />);
    expect(screen.queryAllByTestId('chapter-nav-placeholder')).toHaveLength(0);
  });

  it('draws the placeholder in the chapter bar box', () => {
    render(<WatchDetailsSkeleton hint={{ chapters: true }} />);
    render(<ChapterNav chapters={[]} currentChapter={null} currentChapterIndex={-1} onPrevious={() => undefined} onNext={() => undefined} />);
    const nav = screen.getByTestId('chapter-nav');
    const placeholder = screen.getByTestId('chapter-nav-placeholder');
    for (const cls of CHAPTER_NAV_BOX.split(' ')) {
      expect(nav).toHaveClass(cls);
      expect(placeholder).toHaveClass(cls);
    }
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('server-rendered watch details (wiki AUN-SEO phase 4)', () => {
  it('should render the title as the h1, the channel link, the description and a high-priority poster', () => {
    const { container } = render(
      <WatchDetailsSkeleton
        hint={{ title: 'A lecture', channelName: 'Lectures', channelHref: '/en/@lectures', description: 'About the lecture', poster: '/thumb/v1.jpg', width: 640, height: 360 }}
      />,
    );
    expect(screen.getByRole('heading', { level: 1, name: 'A lecture' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Lectures' })).toHaveAttribute('href', '/en/@lectures');
    expect(screen.getByTestId('watch-skeleton-description')).toHaveTextContent('About the lecture');
    const poster = screen.getByTestId('watch-poster');
    expect(poster).toHaveAttribute('src', '/thumb/v1.jpg');
    expect(poster).toHaveAttribute('fetchpriority', 'high');
    expect(poster).toHaveAttribute('width', '640');
    expect(poster).toHaveAttribute('height', '360');
    // Real content is not announced as a loading placeholder
    expect(container.querySelector('[aria-busy="true"]')).toBeNull();
  });

  it('should stay a busy placeholder when nothing is known', () => {
    const { container } = render(<WatchDetailsSkeleton />);
    expect(container.querySelector('[role="status"][aria-busy="true"]')).not.toBeNull();
    expect(screen.queryByRole('heading', { level: 1 })).toBeNull();
    expect(screen.queryByTestId('watch-poster')).toBeNull();
  });
});
