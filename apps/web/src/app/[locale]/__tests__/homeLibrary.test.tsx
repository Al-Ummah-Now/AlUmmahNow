/**
 * Home page LibraryRow placement (no layout shift / flash):
 * - When the server loaded the library (initialLibrary is defined), LibraryRow renders at the top
 *   of <main>, above HomeHero, on the very first paint (CLS 0).
 * - When the server timed out or failed (initialLibrary is undefined), LibraryRow mounts below the
 *   video grid so a late-arriving client response never pushes the hero and grid down (CLS 0).
 */
import React from 'react';
import { render, screen } from '@testing-library/react';
import VideosPage from '../HomePageClient';
import type { HomeLibraryCard } from '@/lib/home/library-row';

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
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: { id: 'u1' } }) }));
jest.mock('@/components/home/SignInBanner', () => ({ SignInBanner: () => null }));
jest.mock('@/components/home/LibraryRow', () => ({
  LibraryRow: ({ initialCards }: { initialCards?: HomeLibraryCard[] }) => (
    <section data-testid="mock-library-row" data-server={initialCards !== undefined ? 'yes' : 'no'} />
  ),
}));
jest.mock('@/components/videoCard/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card">{title}</div>,
}));
jest.mock('@/components/videoCard/rtl/index', () => ({ __esModule: true, default: () => null }));
jest.mock('@/lib/api/videos', () => ({ fetchVideosWithPagination: jest.fn() }));
jest.mock('@/lib/api/discovery-home', () => ({ getHomeRails: jest.fn(() => Promise.resolve([])) }));

const pageData = {
  data: [
    { id: 'v1', title: 'Tafsir of Al-Fatiha', channelName: 'Lectures', thumbnailUrl: '/thumb/v1.jpg' },
    { id: 'v2', title: 'Hadith', channelName: 'Lectures', thumbnailUrl: '/thumb/v2.jpg' },
  ],
  cursor: '',
} as never;

describe('HomePageClient library row placement', () => {
  it('renders LibraryRow above HomeHero when the server provided initialLibrary', () => {
    const { container } = render(
      <VideosPage initialPage={pageData} initialRails={[]} initialLibrary={[]} initialLibraryUserId="u1" />,
    );
    const lib = screen.getByTestId('mock-library-row');
    const hero = container.querySelector('section.home-hero')!;
    expect(lib).toHaveAttribute('data-server', 'yes');
    expect(Boolean(lib.compareDocumentPosition(hero) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });

  it('mounts the client fallback LibraryRow below the video grid when initialLibrary is omitted (slow server fallback)', () => {
    const { container } = render(<VideosPage initialPage={pageData} initialRails={[]} />);
    const lib = screen.getByTestId('mock-library-row');
    const grid = screen.getByTestId('video-grid');
    const hero = container.querySelector('section.home-hero')!;
    expect(lib).toHaveAttribute('data-server', 'no');
    expect(Boolean(hero.compareDocumentPosition(lib) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
    expect(Boolean(grid.compareDocumentPosition(lib) & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
