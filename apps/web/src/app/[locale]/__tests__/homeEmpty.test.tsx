/**
 * #1629: home with no public videos is never a hollow page (owner's no-hollow-pages rule). It says
 * what will appear and links to Explore, in en and ar, with no upload invitation (uploads are by
 * invitation). A first page that fails to load shows a retry instead of an empty grid.
 */
import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import VideosPage from '../HomePageClient';
import { fetchVideosWithPagination } from '@/lib/api/videos';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => ({
    t: mockLang === 'ar'
      ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
      : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
    lang: mockLang,
    locale: mockLang,
    dir: mockLang === 'ar' ? 'rtl' : 'ltr',
    isRTL: mockLang === 'ar',
  }),
}));
jest.mock('nuqs', () => ({ useQueryState: () => [null, jest.fn()] }));
jest.mock('@/components/AuthProvider/authContext', () => ({ useAuth: () => ({ user: null }), useOptionalAuth: () => ({ user: null }) }));
jest.mock('@/components/home/SignInBanner', () => ({ SignInBanner: () => null }));
jest.mock('@/components/home/LibraryRow', () => ({ LibraryRow: () => null }));
jest.mock('@/lib/api/discovery-home', () => ({ getHomeRails: jest.fn(() => Promise.resolve([])) }));
jest.mock('@/components/common/AppLink', () => ({
  __esModule: true,
  default: ({ href, children, ...rest }: { href: string; children: React.ReactNode }) => <a href={href} {...rest}>{children}</a>,
}));
jest.mock('@/components/videoCard/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card">{title}</div>,
}));
jest.mock('@/components/videoCard/rtl/index', () => ({
  __esModule: true,
  default: ({ title }: { title: string }) => <div data-testid="video-card">{title}</div>,
}));
jest.mock('@/lib/api/videos', () => ({ fetchVideosWithPagination: jest.fn() }));
jest.mock('@/lib/logger-client', () => ({ logger: { error: jest.fn(), warn: jest.fn(), info: jest.fn(), debug: jest.fn() } }));

const mockFetchVideos = fetchVideosWithPagination as jest.MockedFunction<typeof fetchVideosWithPagination>;
const EMPTY = { data: [], cursor: '' } as never;

beforeEach(() => {
  jest.clearAllMocks();
  mockLang = 'en';
});

describe('home with no videos (#1629)', () => {
  it.each([
    ['en', 'No videos yet', 'Go to Explore'],
    ['ar', 'لا توجد مرئيات بعد', 'انتقل إلى «استكشف»'],
  ] as const)('shows the empty state from the server page (%s)', (lang, title, action) => {
    mockLang = lang;
    render(<VideosPage initialPage={EMPTY} />);
    const empty = screen.getByTestId('home-empty');
    expect(empty).toHaveTextContent(title);
    expect(screen.getByTestId('home-empty-explore')).toHaveAttribute('href', `/${lang}/explore`);
    expect(screen.getByTestId('home-empty-explore')).toHaveTextContent(action);
    expect(screen.queryByTestId('video-grid')).not.toBeInTheDocument();
    expect(screen.queryByTestId('home-load-more')).not.toBeInTheDocument();
    // Never an upload invitation: uploading is by invitation (creator tiers)
    expect(document.querySelector('a[href*="/upload"]')).toBeNull();
    expect(empty.textContent).not.toMatch(/upload|ارفع|رفع/i);
  });

  it('shows the empty state once a client-side first page comes back empty', async () => {
    mockFetchVideos.mockResolvedValueOnce(EMPTY);
    render(<VideosPage />);
    expect(screen.getByTestId('video-grid-loading')).toBeInTheDocument();
    expect(await screen.findByTestId('home-empty')).toBeInTheDocument();
    expect(screen.queryByTestId('video-grid-loading')).not.toBeInTheDocument();
  });

  it('shows the grid, not the empty state, when there are videos', () => {
    render(<VideosPage initialPage={{ data: [{ id: 'v1', title: 'Surat Al-Kahf recitation' }], cursor: '' } as never} />);
    expect(screen.getAllByTestId('video-card')).toHaveLength(1);
    expect(screen.queryByTestId('home-empty')).not.toBeInTheDocument();
  });

  it.each(['en', 'ar'] as const)('a failed first page shows a retry that loads the videos (%s)', async (lang) => {
    mockLang = lang;
    mockFetchVideos.mockRejectedValueOnce(new Error('network')).mockResolvedValueOnce({ data: [{ id: 'v1', title: 'Friday reminder' }], cursor: '' } as never);
    render(<VideosPage />);
    const alert = await screen.findByTestId('home-load-failed');
    expect(alert).toHaveTextContent(lang === 'ar' ? 'تعذّر تحميل المرئيات.' : "Videos couldn't be loaded.");
    expect(screen.queryByTestId('home-empty')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: lang === 'ar' ? 'إعادة المحاولة' : 'Retry' }));
    await waitFor(() => expect(screen.getAllByTestId('video-card')).toHaveLength(1));
    expect(screen.queryByTestId('home-load-failed')).not.toBeInTheDocument();
    expect(mockFetchVideos).toHaveBeenCalledTimes(2);
  });
});
