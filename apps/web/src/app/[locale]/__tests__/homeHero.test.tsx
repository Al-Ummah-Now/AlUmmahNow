/**
 * Home page featured hero: its frame is on the page from the first paint, so the hero arriving
 * with the first page of videos does not push the heading and grid down (Lighthouse CLS 0.84).
 */
import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import VideosPage from '../HomePageClient';
import { fetchVideosWithPagination } from '@/lib/api/videos';

jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: 'en',
    locale: 'en',
    dir: 'ltr',
    isRTL: false,
  }),
}));
jest.mock('nuqs', () => ({ useQueryState: () => [null, jest.fn()] }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: null }) }));
jest.mock('@/components/history/ContinueWatchingShelf', () => ({ ContinueWatchingShelf: () => null }));
jest.mock('@/components/videoCard/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card">{title}</div>,
}));
jest.mock('@/components/videoCard/rtl/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/api/videos', () => ({ fetchVideosWithPagination: jest.fn() }));

const mockFetchVideos = fetchVideosWithPagination as jest.MockedFunction<typeof fetchVideosWithPagination>;

const video = (id: string, title: string) =>
  ({ id, title, channelName: 'Lectures', thumbnailUrl: `https://cdn.example/${id}.jpg` }) as never;

/**
 * The hero's rows in order: placeholder and hero must match. The button is a link in the hero and
 * an inert box in the placeholder; both are `.b` (one inline-flex button size), so it is compared
 * by class, the other rows by tag and class.
 */
function frame(section: Element) {
  const body = section.querySelector('.home-hero-b')!;
  return {
    thumb: section.querySelectorAll(':scope > .home-hero-t').length,
    rows: Array.from(body.children).map((el) =>
      el.classList.contains('b') ? '.b.b-primary' : `${el.tagName.toLowerCase()}.${el.className.split(' ').filter((c) => c.startsWith('home-hero')).join('.')}`),
  };
}

describe('home featured hero', () => {
  beforeEach(() => jest.clearAllMocks());

  it('holds the hero frame while the first page loads, then swaps in the hero in its place', async () => {
    let resolve!: (v: unknown) => void;
    mockFetchVideos.mockReturnValueOnce(new Promise((r) => { resolve = r; }) as never);
    const { container } = render(<VideosPage />);

    const placeholder = screen.getByTestId('home-hero-loading');
    expect(placeholder).toHaveAttribute('aria-hidden', 'true');
    expect(placeholder.nextElementSibling?.tagName).toBe('H1');
    const before = frame(placeholder);

    resolve({ data: [video('v1', 'Tafsir of Al-Fatiha')], cursor: '' });
    await waitFor(() => expect(screen.queryByTestId('home-hero-loading')).not.toBeInTheDocument());
    const hero = container.querySelector('section.home-hero')!;
    expect(hero).toHaveTextContent('Tafsir of Al-Fatiha');
    expect(hero.nextElementSibling?.tagName).toBe('H1');
    // Same thumbnail box and the same rows (tag, title, channel, button) in the same order
    expect(frame(hero)).toEqual(before);
    expect(before).toEqual({ thumb: 1, rows: ['span.home-hero-tag', 'h2.', 'p.', '.b.b-primary'] });
    expect(hero.querySelector('.b')).toHaveClass('b-primary');
  });

  it('shows Load more only when there is a next page, so a short first page moves nothing into view', async () => {
    let resolve!: (v: unknown) => void;
    mockFetchVideos.mockReturnValueOnce(new Promise((r) => { resolve = r; }) as never);
    const { unmount } = render(<VideosPage />);
    // Not under the placeholder grid either: it would jump up when a short page replaced it
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument();
    resolve({ data: [video('v1', 'Tafsir'), video('v2', 'Hadith')], cursor: '' });
    await waitFor(() => expect(screen.queryByTestId('video-grid-loading')).not.toBeInTheDocument());
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument();
    unmount();

    mockFetchVideos.mockResolvedValueOnce({ data: [video('v1', 'Tafsir'), video('v2', 'Hadith')], cursor: 'next-page' } as never);
    render(<VideosPage />);
    expect((await screen.findByTestId('home-load-more')).querySelector('button')).not.toBeNull();
  });

  it('drops the frame when there is nothing to feature', async () => {
    mockFetchVideos.mockResolvedValueOnce({ data: [], cursor: '' } as never);
    const { container } = render(<VideosPage />);
    expect(screen.getByTestId('home-hero-loading')).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByTestId('home-hero-loading')).not.toBeInTheDocument());
    expect(container.querySelector('section.home-hero')).toBeNull();
  });
});
