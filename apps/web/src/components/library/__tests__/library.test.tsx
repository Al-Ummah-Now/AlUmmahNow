import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';

let mockLang: 'en' | 'ar' = 'en';
jest.mock('@/hooks/useLanguage', () => ({
  useLanguage: () => {
    const isAr = mockLang === 'ar';
    return {
      t: isAr
        ? jest.requireActual('@/lib/i18n/translations/ar').AR_TRANSLATIONS
        : jest.requireActual('@/lib/i18n/translations/en').EN_TRANSLATIONS,
      lang: mockLang,
      locale: mockLang,
      dir: isAr ? 'rtl' : 'ltr',
      isRTL: isAr,
    };
  },
}));

let mockUser: { id: string } | null = { id: 'u1' };
jest.mock('@/components/AuthProvider/authContext', () => ({
  useAuth: () => ({ user: mockUser }),
}));

jest.mock('@/components/VideoThumbnail', () => ({
  __esModule: true,
  default: ({ alt }: { alt: string }) => <span data-testid="thumb">{alt}</span>,
}));

jest.mock('@/services/api/library', () => ({
  LibraryService: {
    watchLater: jest.fn(),
    liked: jest.fn(),
    savedPosts: jest.fn(),
    isInWatchLater: jest.fn(),
    addToWatchLater: jest.fn(),
    removeFromWatchLater: jest.fn(),
    reorderWatchLater: jest.fn(),
  },
}));

import { LibraryService } from '@/services/api/library';
import { LibraryListPage } from '../LibraryListPage';
import { WatchLaterButton } from '../WatchLaterButton';
import { VideoCardMenu } from '../VideoCardMenu';

const service = LibraryService as jest.Mocked<typeof LibraryService>;

const video = (id: string) => ({ id, title: `Video ${id}`, thumbnailUrl: null, channelName: 'Noor', duration: 125 });

describe('Watch later page', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    mockUser = { id: 'u1' };
    service.watchLater.mockResolvedValue({
      items: [video('a'), video('b')] as never,
      nextCursor: null,
      total: 2,
      playlistId: 'watch-later-u1',
      videoIds: ['a', 'b'],
    });
    service.reorderWatchLater.mockResolvedValue(true);
    service.removeFromWatchLater.mockResolvedValue({ ok: true, saved: false });
  });

  it('lists saved videos, reorders with buttons and removes', async () => {
    render(<LibraryListPage kind="watch-later" dir="ltr" />);
    await waitFor(() => expect(screen.getAllByTestId('library-list-item')).toHaveLength(2));
    // Played as the viewer's Watch later list (docs/specs/PLAYLIST-PLAYBACK.md: WL alias, stored index)
    expect(screen.getAllByTestId('library-video')[0]).toHaveAttribute('href', '/en/video/a?list=WL&index=0');
    expect(screen.getAllByTestId('library-video')[1]).toHaveAttribute('href', '/en/video/b?list=WL&index=1');
    expect(screen.getByTestId('library-play-all')).toHaveAttribute('href', '/en/video/a?list=WL&index=0');

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Move down: Video a' }));
    });
    expect(service.reorderWatchLater).toHaveBeenCalledWith(['b', 'a']);
    expect(screen.getAllByTestId('library-list-item').map((el) => el.getAttribute('data-video-id'))).toEqual(['b', 'a']);

    await act(async () => {
      fireEvent.click(screen.getAllByTestId('watch-later-remove')[0]);
    });
    expect(service.removeFromWatchLater).toHaveBeenCalledWith('b');
    expect(screen.getAllByTestId('library-list-item')).toHaveLength(1);
  });

  it('renders the Arabic RTL page with an empty state', async () => {
    mockLang = 'ar';
    service.liked.mockResolvedValue({ items: [], nextCursor: null, total: 0 });
    render(<LibraryListPage kind="liked" dir="rtl" />);
    await waitFor(() => expect(screen.getByTestId('library-list-empty')).toHaveTextContent('ستظهر هنا المرئيات التي تعجبك'));
    expect(screen.getByTestId('library-liked-page')).toHaveAttribute('dir', 'rtl');
  });

  it('asks anonymous visitors to sign in', () => {
    mockUser = null;
    render(<LibraryListPage kind="watch-later" dir="ltr" />);
    expect(screen.getByText('Sign in to see your library')).toBeInTheDocument();
    expect(service.watchLater).not.toHaveBeenCalled();
  });
});

describe('Watch later controls', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLang = 'en';
    mockUser = { id: 'u1' };
  });

  it('toggles from the watch page', async () => {
    service.isInWatchLater.mockResolvedValue(false);
    service.addToWatchLater.mockResolvedValue({ ok: true, saved: true });
    render(<WatchLaterButton videoId="v1" />);
    const button = await screen.findByTestId('watch-later-button');
    await act(async () => {
      fireEvent.click(button);
    });
    expect(service.addToWatchLater).toHaveBeenCalledWith('v1');
    expect(button).toHaveAttribute('aria-pressed', 'true');
    expect(button).toHaveTextContent('Remove from Watch later');
  });

  it('saves from the card overflow menu and reports a full list', async () => {
    service.addToWatchLater.mockResolvedValue({ ok: false, error: 'full' });
    render(<VideoCardMenu videoId="v9" title="Nine" />);
    const trigger = screen.getByRole('button', { name: 'More actions for Nine' });
    fireEvent.keyDown(trigger, { key: 'Enter' });
    await act(async () => {
      fireEvent.click(screen.getByRole('menuitem', { name: 'Save to Watch later' }));
    });
    expect(service.addToWatchLater).toHaveBeenCalledWith('v9');
    expect(screen.getByTestId('video-card-menu-status')).toHaveTextContent('Watch later is full');
  });

  it('is hidden for anonymous viewers', () => {
    mockUser = null;
    const { container } = render(<VideoCardMenu videoId="v9" title="Nine" />);
    expect(container).toBeEmptyDOMElement();
  });
});
